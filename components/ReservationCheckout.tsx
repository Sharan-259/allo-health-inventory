"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  CheckCircle,
  XCircle,
  ShoppingBag,
  MapPin,
  AlertTriangle,
  Package,
} from "lucide-react";

interface Reservation {
  id: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
  stockLevel: {
    id: string;
    product: { id: string; name: string; sku: string; price: number; description: string | null };
    warehouse: { id: string; name: string; location: string };
  };
}

function Countdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    if (secondsLeft === 0) {
      onExpired();
      return;
    }
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          onExpired();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft, onExpired]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const urgent = secondsLeft < 60;

  return (
    <div
      className={`flex items-center gap-2 text-lg font-mono font-bold ${
        urgent ? "text-red-600" : "text-amber-600"
      }`}
    >
      <Clock size={20} className={urgent ? "animate-pulse" : ""} />
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </div>
  );
}

export function ReservationCheckout({
  initialReservation,
}: {
  initialReservation: Reservation;
}) {
  const router = useRouter();
  const [reservation, setReservation] = useState<Reservation>(initialReservation);
  const [loading, setLoading] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshReservation = useCallback(async () => {
    const res = await fetch(`/api/reservations/${reservation.id}`);
    if (res.ok) {
      const data = await res.json();
      setReservation(data);
    }
  }, [reservation.id]);

  const handleExpired = useCallback(() => {
    refreshReservation();
  }, [refreshReservation]);

  const handleConfirm = async () => {
    setError(null);
    setLoading("confirm");
    try {
      const res = await fetch(`/api/reservations/${reservation.id}/confirm`, {
        method: "POST",
        headers: {
          "idempotency-key": `confirm-${reservation.id}`,
        },
      });
      const data = await res.json();

      if (res.status === 410) {
        setError(data.error || "This reservation has expired.");
        await refreshReservation();
        return;
      }

      if (!res.ok) {
        setError(data.error || "Failed to confirm reservation.");
        return;
      }

      setReservation(data);
    } finally {
      setLoading(null);
    }
  };

  const handleCancel = async () => {
    setError(null);
    setLoading("cancel");
    try {
      const res = await fetch(`/api/reservations/${reservation.id}/release`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to cancel reservation.");
        return;
      }

      setReservation(data);
    } finally {
      setLoading(null);
    }
  };

  const { stockLevel, status } = reservation;
  const { product, warehouse } = stockLevel;
  const total = product.price * reservation.quantity;

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          ← Back to products
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Status banner */}
        {status === "CONFIRMED" && (
          <div className="bg-green-50 border-b border-green-200 px-6 py-4 flex items-center gap-3">
            <CheckCircle size={22} className="text-green-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-green-800">Order confirmed!</p>
              <p className="text-sm text-green-600">Your purchase is complete.</p>
            </div>
          </div>
        )}
        {status === "RELEASED" && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-4 flex items-center gap-3">
            <XCircle size={22} className="text-red-400 flex-shrink-0" />
            <div>
              <p className="font-semibold text-red-700">Reservation released</p>
              <p className="text-sm text-red-500">
                {reservation.releasedAt && new Date(reservation.releasedAt) < new Date(reservation.expiresAt)
                  ? "You cancelled this reservation."
                  : "This reservation expired and the item was returned to stock."}
              </p>
            </div>
          </div>
        )}

        {/* Product info */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Package size={24} className="text-blue-500" />
            </div>
            <div className="flex-1">
              <h1 className="font-bold text-gray-900 text-lg leading-tight">{product.name}</h1>
              <p className="text-sm text-gray-400 font-mono mt-0.5">{product.sku}</p>
              {product.description && (
                <p className="text-sm text-gray-500 mt-2">{product.description}</p>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-3 text-sm">
            <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-gray-500 flex items-center gap-1.5">
                <MapPin size={14} />
                Warehouse
              </span>
              <span className="font-medium text-gray-800">
                {warehouse.name}
                <span className="text-gray-400 font-normal"> · {warehouse.location}</span>
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-gray-500">Quantity</span>
              <span className="font-medium text-gray-800">{reservation.quantity}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
              <span className="text-gray-500">Unit price</span>
              <span className="font-medium text-gray-800">₹{product.price.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="font-semibold text-gray-800">Total</span>
              <span className="font-bold text-gray-900 text-lg">₹{total.toLocaleString("en-IN")}</span>
            </div>
          </div>

          {/* Countdown / status */}
          {status === "PENDING" && (
            <div className="mt-5 p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  Reserved — time remaining
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Complete checkout before the timer runs out
                </p>
              </div>
              <Countdown expiresAt={reservation.expiresAt} onExpired={handleExpired} />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-600 flex items-center gap-1.5">
                <AlertTriangle size={14} />
                {error}
              </p>
            </div>
          )}

          {/* Actions */}
          {status === "PENDING" && (
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={loading !== null}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg
                  bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {loading === "confirm" ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Processing…
                  </>
                ) : (
                  <>
                    <ShoppingBag size={16} />
                    Confirm purchase
                  </>
                )}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading !== null}
                className="px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium
                  hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                {loading === "cancel" ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          )}

          {(status === "CONFIRMED" || status === "RELEASED") && (
            <div className="mt-6">
              <button
                onClick={() => router.push("/")}
                className="w-full py-3 px-4 rounded-lg border border-gray-300 text-gray-700 font-medium
                  hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                ← Back to products
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Debug info */}
      <div className="mt-4 p-4 rounded-lg bg-gray-50 border border-gray-200">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          Reservation details
        </p>
        <div className="text-xs text-gray-500 space-y-1 font-mono">
          <div>ID: {reservation.id}</div>
          <div>Status: {reservation.status}</div>
          <div>Expires: {new Date(reservation.expiresAt).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
