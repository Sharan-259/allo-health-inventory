import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/expiry";

export async function GET() {
  // Lazy cleanup: release expired reservations before returning stock levels
  await releaseExpiredReservations();

  const products = await prisma.product.findMany({
    include: {
      stockLevels: {
        include: { warehouse: true },
        orderBy: { warehouse: { name: "asc" } },
      },
    },
    orderBy: { name: "asc" },
  });

  // Compute available = totalUnits - reserved
  const result = products.map((p) => ({
    ...p,
    stockLevels: p.stockLevels.map((s) => ({
      ...s,
      available: Math.max(0, s.totalUnits - s.reserved),
    })),
  }));

  return NextResponse.json(result);
}
