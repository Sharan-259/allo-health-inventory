import { prisma } from "./prisma";

/**
 * Release all expired PENDING reservations and return freed stock.
 * Called lazily on each reservation read, and also by the cron endpoint.
 */
export async function releaseExpiredReservations(): Promise<number> {
  const now = new Date();

  // Find expired pending reservations
  const expired = await prisma.reservation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
    },
    select: { id: true, stockLevelId: true, quantity: true },
  });

  if (expired.length === 0) return 0;

  // Release each in its own transaction to avoid one failure blocking others
  let released = 0;
  for (const res of expired) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: res.id },
          data: { status: "RELEASED", releasedAt: now },
        });
        await tx.stockLevel.update({
          where: { id: res.stockLevelId },
          data: { reserved: { decrement: res.quantity } },
        });
      });
      released++;
    } catch (err) {
      console.error(`Failed to release reservation ${res.id}:`, err);
    }
  }

  return released;
}
