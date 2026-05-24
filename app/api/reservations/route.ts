import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { acquireLockWithRetry } from "@/lib/lock";
import { CreateReservationSchema } from "@/lib/schemas";
import { ok, conflict, badRequest, serverError } from "@/lib/api";

const RESERVATION_TTL_MINUTES = 10;

type TransactionResult =
  | { error: string; status: number; reservation?: never }
  | { reservation: object; error?: never; status?: never };

export async function POST(req: NextRequest) {
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

  const lockKey = `reserve:${productId}:${warehouseId}`;
  const release = await acquireLockWithRetry(lockKey, { maxAttempts: 5, delayMs: 80 });

  if (!release) {
    return conflict("Another reservation is in progress. Please try again.");
  }

  try {
    const result: TransactionResult = await prisma.$transaction(async (tx) => {
      type StockRow = { id: string; totalUnits: number; reserved: number };
      const stockLevel = await tx.$queryRaw`
        SELECT id, "totalUnits", reserved
        FROM "StockLevel"
        WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
        FOR UPDATE
      ` as StockRow[];

      if (stockLevel.length === 0) {
        return { error: "Stock level not found", status: 404 };
      }

      const sl = stockLevel[0];
      const available = sl.totalUnits - sl.reserved;

      if (available < quantity) {
        return {
          error: `Only ${available} unit${available === 1 ? "" : "s"} available (${quantity} requested)`,
          status: 409,
        };
      }

      await tx.stockLevel.update({
        where: { id: sl.id },
        data: { reserved: { increment: quantity } },
      });

      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
      const reservation = await tx.reservation.create({
        data: { stockLevelId: sl.id, quantity, status: "PENDING", expiresAt },
        include: { stockLevel: { include: { product: true, warehouse: true } } },
      });

      return { reservation };
    });

    if (result.error !== undefined) {
      const errMsg = result.error;
      const statusCode = result.status ?? 500;
      if (idempotencyKey) {
        await prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            endpoint: "/api/reservations",
            responseBody: { error: errMsg },
            statusCode,
          },
        });
      }
      return statusCode === 409 ? conflict(errMsg) : badRequest(errMsg);
    }

    const responseBody = result.reservation;
    if (idempotencyKey) {
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          endpoint: "/api/reservations",
          responseBody: JSON.parse(JSON.stringify(responseBody)),
          statusCode: 201,
          reservationId: (responseBody as { id: string }).id,
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
