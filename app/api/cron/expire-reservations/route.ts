import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredReservations } from "@/lib/expiry";

// This endpoint is called by Vercel Cron (or any external scheduler).
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/expire-reservations", "schedule": "* * * * *" }] }
// Vercel sends the CRON_SECRET as Authorization: Bearer <secret>
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const released = await releaseExpiredReservations();
  return NextResponse.json({ released, timestamp: new Date().toISOString() });
}
