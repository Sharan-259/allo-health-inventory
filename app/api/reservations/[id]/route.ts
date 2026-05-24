import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/lib/api";
import { releaseExpiredReservations } from "@/lib/expiry";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  // Lazy expiry check
  await releaseExpiredReservations();

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: {
      stockLevel: {
        include: { product: true, warehouse: true },
      },
    },
  });

  if (!reservation) return notFound("Reservation not found");

  return ok(reservation);
}
