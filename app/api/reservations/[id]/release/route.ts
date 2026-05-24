import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, conflict, serverError } from "@/lib/api";

type ReservationRow = {
  id: string;
  status: string;
  stockLevelId: string;
  quantity: number;
};

export async function POST(
  _req: NextRequest,
  context: { params: { id: string } }
) {
  const { id } = context.params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id, status, "stockLevelId", quantity
        FROM "Reservation"
        WHERE id = ${id}
        FOR UPDATE
      ` as ReservationRow[];

      if (rows.length === 0) {
        return { error: "Reservation not found", status: 404 };
      }

      const reservation = rows[0];

      if (reservation.status === "RELEASED") {
        const full = await tx.reservation.findUnique({ where: { id } });
        return { reservation: full };
      }

      if (reservation.status === "CONFIRMED") {
        return { error: "Cannot release a confirmed reservation", status: 409 };
      }

      const released = await tx.reservation.update({
        where: { id },
        data: { status: "RELEASED", releasedAt: new Date() },
        include: {
          stockLevel: { include: { product: true, warehouse: true } },
        },
      });

      await tx.stockLevel.update({
        where: { id: reservation.stockLevelId },
        data: { reserved: { decrement: reservation.quantity } },
      });

      return { reservation: released };
    });

    if ("error" in result) {
      return result.status === 404
        ? notFound(result.error)
        : conflict(result.error);
    }

    return ok(result.reservation);
  } catch (err) {
    console.error("Release error:", err);
    return serverError();
  }
}
