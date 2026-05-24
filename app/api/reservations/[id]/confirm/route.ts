import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, gone, notFound, conflict, serverError } from "@/lib/api";

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id } = context.params;

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

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw
        Array<{ id: string; status: string; expiresAt: Date }>
      >`
        SELECT id, status, "expiresAt"
        FROM "Reservation"
        WHERE id = ${id}
        FOR UPDATE
      `;

      if (rows.length === 0) {
        return { error: "Reservation not found", status: 404 };
      }

      const reservation = rows[0];

      if (reservation.status === "CONFIRMED") {
        const full = await tx.reservation.findUnique({ where: { id } });
        return { reservation: full };
      }

      if (reservation.status === "RELEASED") {
        return { error: "Reservation has already been released", status: 410 };
      }

      if (new Date() > reservation.expiresAt) {
        const res = await tx.reservation.findUnique({
          where: { id },
          select: { stockLevelId: true, quantity: true },
        });
        if (res) {
          await tx.stockLevel.update({
            where: { id: res.stockLevelId },
            data: { reserved: { decrement: res.quantity } },
          });
        }
        await tx.reservation.update({
          where: { id },
          data: { status: "RELEASED", releasedAt: new Date() },
        });
        return { error: "Reservation has expired", status: 410 };
      }

      const confirmed = await tx.reservation.update({
        where: { id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
        include: {
          stockLevel: {
            include: { product: true, warehouse: true },
          },
        },
      });

      await tx.stockLevel.update({
        where: { id: confirmed.stockLevelId },
        data: {
          totalUnits: { decrement: confirmed.quantity },
          reserved: { decrement: confirmed.quantity },
        },
      });

      return { reservation: confirmed };
    });

    if ("error" in result) {
      const response =
        result.status === 404
          ? notFound(result.error)
          : result.status === 410
          ? gone(result.error)
          : conflict(result.error);

      if (idempotencyKey) {
        await prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            endpoint: `/api/reservations/${id}/confirm`,
            responseBody: { error: result.error },
            statusCode: result.status,
          },
        });
      }
      return response;
    }

    if (idempotencyKey) {
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          endpoint: `/api/reservations/${id}/confirm`,
          responseBody: result.reservation as unknown as Record<string, unknown>,
          statusCode: 200,
          reservationId: id,
        },
      });
    }

    return ok(result.reservation);
  } catch (err) {
    console.error("Confirm error:", err);
    return serverError();
  }
}
