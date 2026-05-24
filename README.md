# Allo Inventory — Take-Home Exercise

A Next.js inventory reservation system that solves the checkout race condition for multi-warehouse retail.

## Live Demo

> Deploy to Vercel + Supabase + Upstash and paste your URL here.

---

## Running Locally

### Prerequisites

- Node.js 18+
- A hosted Postgres instance (Supabase, Neon, or Railway — all have free tiers)
- Redis (Upstash free tier) — optional but recommended

### 1. Clone and install

```bash
git clone <your-repo>
cd allo-inventory
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and set `DATABASE_URL` (required) and `REDIS_URL` (optional).

**Supabase:** Go to Settings → Database → Connection string → URI mode.  
**Neon:** Dashboard → Connection Details → Connection string.  
**Upstash Redis:** Create a database → copy the Redis URL.

### 3. Run migrations and seed

```bash
# Push schema to database (first time)
npm run db:push

# Or use migrations (recommended for production)
npm run db:generate
npm run db:migrate

# Seed demo data
npm run db:seed
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List products with available stock per warehouse |
| GET | `/api/warehouses` | List warehouses |
| POST | `/api/reservations` | Reserve units — returns 409 if insufficient stock |
| GET | `/api/reservations/:id` | Fetch a single reservation |
| POST | `/api/reservations/:id/confirm` | Confirm payment — returns 410 if expired |
| POST | `/api/reservations/:id/release` | Release / cancel a reservation |
| GET | `/api/cron/expire-reservations` | Cron endpoint — releases expired reservations |

### Idempotency

The `POST /api/reservations` and `POST /api/reservations/:id/confirm` endpoints support idempotency.  
Pass an `Idempotency-Key: <unique-string>` header. The server stores the response keyed by that value and returns it verbatim on repeated requests, preventing duplicate side effects on retries.

---

## How Concurrency Safety Works

The reservation endpoint must guarantee: "if two requests arrive simultaneously for the last unit, exactly one succeeds."

Two complementary layers handle this:

### Layer 1 — Redis distributed lock

Before any database work, the handler acquires a Redis lock keyed on `(productId, warehouseId)` using `SET NX PX` (atomic set-if-not-exists with TTL). Only one request proceeds at a time; others either wait and retry (up to 5 attempts with linear backoff) or return a `409`.

This keeps the Postgres transaction short and avoids connection pool pressure under high concurrency.

### Layer 2 — Postgres `SELECT FOR UPDATE`

Inside the transaction, we issue:

```sql
SELECT id, "totalUnits", reserved FROM "StockLevel"
WHERE "productId" = $1 AND "warehouseId" = $2
FOR UPDATE
```

This acquires an exclusive row lock at the database level. Even if the Redis layer is unavailable (no `REDIS_URL` set), two concurrent transactions cannot both read "available > 0" and both proceed — the second is blocked until the first commits or rolls back.

The `reserved` counter is then incremented atomically within the same transaction.

> **Why not just use Postgres?** `SELECT FOR UPDATE` alone is correct, but under heavy load it causes lock contention that shows up as connection pool timeouts. Redis coalesces concurrent requests upstream, so the DB only ever sees one at a time per SKU.

---

## How Reservation Expiry Works

Reservations have an `expiresAt` timestamp set 10 minutes from creation.

Three mechanisms ensure expired reservations are cleaned up:

### 1. Lazy cleanup on read (always active)

`GET /api/products` and `GET /api/reservations/:id` call `releaseExpiredReservations()` before returning data. This scans for `status = PENDING AND expiresAt < now()` and releases them. No background process required.

### 2. Vercel Cron (production)

`vercel.json` configures a cron job that calls `GET /api/cron/expire-reservations` every minute. This is the primary production mechanism and ensures expiry even if no one is browsing the product listing.

```json
{
  "crons": [{ "path": "/api/cron/expire-reservations", "schedule": "* * * * *" }]
}
```

Protect the endpoint with `CRON_SECRET` in production.

### 3. Confirm endpoint check

`POST /api/reservations/:id/confirm` checks `expiresAt` inside the transaction. If expired it releases the stock and returns 410, even if the cron hasn't run yet.

**Trade-off:** Lazy cleanup means a product listing could briefly show 0 available when units are actually held by expired reservations — until the next page load. A background worker (e.g. BullMQ + Redis) would be more precise but adds operational complexity.

---

## Project Structure

```
app/
  page.tsx                        # Product listing (server component)
  reservations/[id]/page.tsx      # Checkout page (server component)
  api/
    products/route.ts
    warehouses/route.ts
    reservations/
      route.ts                    # POST — create reservation
      [id]/route.ts               # GET — fetch reservation
      [id]/confirm/route.ts       # POST — confirm
      [id]/release/route.ts       # POST — release
    cron/expire-reservations/     # Cron handler

components/
  ProductGrid.tsx                 # Product listing UI (client)
  ReservationCheckout.tsx         # Countdown + confirm/cancel UI (client)

lib/
  prisma.ts                       # PrismaClient singleton
  redis.ts                        # Redis client singleton
  lock.ts                         # Distributed lock (Redis SET NX)
  schemas.ts                      # Zod schemas shared by API + frontend
  api.ts                          # Response helpers
  expiry.ts                       # releaseExpiredReservations()

prisma/
  schema.prisma
  seed.ts
```

---

## Deployment (Vercel + Supabase + Upstash)

1. Push to GitHub
2. Import repo in Vercel
3. Set environment variables:
   - `DATABASE_URL` — Supabase connection string
   - `REDIS_URL` — Upstash Redis URL
   - `CRON_SECRET` — random secret string
4. After first deploy, run migrations:
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```
   (or use Vercel's build command: `prisma migrate deploy && next build`)

---

## Trade-offs & What I'd Do With More Time

- **Reservation TTL in config:** The 10-minute window is hardcoded. It should be a database-backed or env-var setting.
- **Quantity > 1:** The UI always reserves 1 unit. A quantity selector would be a small addition.
- **Auth:** No user identity — reservations are anonymous. In production, reservations would be tied to a user session.
- **Optimistic UI on product listing:** After a successful reservation, the product listing stock count isn't updated until next navigation. Could use SWR/React Query for background refetching.
- **BullMQ for expiry:** Vercel Cron has 1-minute granularity. A Redis-backed job queue would allow exact-time expiry scheduling.
- **Tests:** I'd add integration tests for the concurrency scenario specifically — spin up two concurrent requests against a test DB and assert exactly one succeeds.
