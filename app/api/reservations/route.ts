import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { acquireLockWithRetry } from "@/lib/lock";
import { CreateReservationSchema } from "@/lib/schemas";
import { ok, conflict, badRequest, serverError } from "@/lib/api";

const RESERVATION_TTL_MINUTES = 10;

export async function POST(req: NextRequest) {
  // ── Idempotency ──────────────────────────────────────────────────────────
  const idempotencyKey = req.headers.get("idempotency-key");
  if (idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });
    if (existing) {
      return new Response(JSON.stringify(existing.responseBody), {
        status: existing.statusCode,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ── Validate body ────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsed = CreateReservationSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.errors.map((e) => e.message).join(", "));
  }

  const { productId, warehouseId, quantity } = parsed.data;

  // ── Distributed lock per (product, warehouse) ────────────────────────────
  // Prevents two concurrent requests from both reading "available > 0" and
  // both proceeding to reserve the last unit.
  const lockKey = `reserve:${productId}:${warehouseId}`;
  const release = await acquireLockWithRetry(lockKey, {
    maxAttempts: 5,
    delayMs: 80,
  });

  if (!release) {
    return conflict("Another reservation is in progress for this item. Please try again.");
  }

  try {
    // ── Transactional stock check + reserve ──────────────────────────────
    // Even with the Redis lock, we use SELECT FOR UPDATE inside the
    // transaction so this is safe if Redis is unavailable or in a
    // single-instance deployment without Redis.
    const result = await prisma.$transaction(async (tx) => {
      // Lock the row at the DB level
      const stockLevel = await tx.$queryRaw<
        Array<{
          id: string;
          totalUnits: number;
          reserved: number;
        }>
      >`
        SELECT id, "totalUnits", reserved
        FROM "StockLevel"
        WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
        FOR UPDATE
      `;

      if (stockLevel.length === 0) {
        return { error: "Stock level not found for this product/warehouse combination", status: 404 };
      }

      const sl = stockLevel[0];
      const available = sl.totalUnits - sl.reserved;

      if (available < quantity) {
        return {
          error: `Only ${available} unit${available === 1 ? "" : "s"} available (${quantity} requested)`,
          status: 409,
        };
      }

      // Increment reserved
      await tx.stockLevel.update({
        where: { id: sl.id },
        data: { reserved: { increment: quantity } },
      });

      // Create reservation
      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
      const reservation = await tx.reservation.create({
        data: {
          stockLevelId: sl.id,
          quantity,
          status: "PENDING",
          expiresAt,
        },
        include: {
          stockLevel: {
            include: {
              product: true,
              warehouse: true,
            },
          },
        },
      });

      return { reservation };
    });

    // ── Handle transaction result ────────────────────────────────────────
    if ("error" in result) {
      const response =
        result.status === 409
          ? conflict(result.error)
          : badRequest(result.error);

      if (idempotencyKey) {
        await prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            endpoint: "/api/reservations",
            responseBody: { error: result.error },
            statusCode: result.status,
          },
        });
      }

      return response;
    }

    const responseBody = result.reservation;

    // ── Persist idempotency record ───────────────────────────────────────
    if (idempotencyKey) {
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          endpoint: "/api/reservations",
          responseBody: responseBody as unknown as Record<string, unknown>,
          statusCode: 201,
          reservationId: result.reservation.id,
        },
      });
    }

    return ok(responseBody, 201);
  } catch (err) {
    console.error("Reservation error:", err);
    return serverError();
  } finally {
    await release();
  }
}
