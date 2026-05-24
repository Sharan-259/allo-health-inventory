"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, MapPin, AlertTriangle, CheckCircle } from "lucide-react";

interface StockLevel {
  id: string;
  warehouseId: string;
  totalUnits: number;
  reserved: number;
  available: number;
  warehouse: { id: string; name: string; location: string };
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  stockLevels: StockLevel[];
}

function StockBadge({ available }: { available: number }) {
  if (available === 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
        Out of stock
      </span>
    );
  if (available <= 3)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
        <AlertTriangle size={10} />
        Only {available} left
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
      <CheckCircle size={10} />
      {available} available
    </span>
  );
}

function ProductCard({ product }: { product: Product }) {
  const router = useRouter();
  const [loadingWarehouse, setLoadingWarehouse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReserve = async (stockLevel: StockLevel) => {
    setError(null);
    setLoadingWarehouse(stockLevel.warehouseId);

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Idempotency key: product + warehouse + timestamp (new key per attempt)
          "idempotency-key": `${product.id}-${stockLevel.warehouseId}-${Date.now()}`,
        },
        body: JSON.stringify({
          productId: product.id,
          warehouseId: stockLevel.warehouseId,
          quantity: 1,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setError(data.error || "Not enough stock available.");
        return;
      }

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      router.push(`/reservations/${data.id}`);
    } finally {
      setLoadingWarehouse(null);
    }
  };

  const totalAvailable = product.stockLevels.reduce((s, sl) => s + sl.available, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Product header */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Package size={20} className="text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900 leading-tight">{product.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{product.sku}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="font-bold text-gray-900">₹{product.price.toLocaleString("en-IN")}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalAvailable} total avail.
            </p>
          </div>
        </div>
        {product.description && (
          <p className="text-sm text-gray-500 mt-3 leading-relaxed">{product.description}</p>
        )}
      </div>

      {/* Stock per warehouse */}
      <div className="p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Warehouse Stock
        </p>
        <div className="space-y-2">
          {product.stockLevels.map((sl) => (
            <div
              key={sl.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <MapPin size={14} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{sl.warehouse.name}</p>
                  <p className="text-xs text-gray-400 truncate">{sl.warehouse.location}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <StockBadge available={sl.available} />
                <button
                  onClick={() => handleReserve(sl)}
                  disabled={sl.available === 0 || loadingWarehouse === sl.warehouseId}
                  className="text-sm px-3 py-1.5 rounded-md font-medium transition-all
                    bg-blue-600 text-white hover:bg-blue-700
                    disabled:opacity-40 disabled:cursor-not-allowed
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                >
                  {loadingWarehouse === sl.warehouseId ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Reserving…
                    </span>
                  ) : (
                    "Reserve"
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-600 font-medium flex items-center gap-1.5">
              <AlertTriangle size={14} />
              {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <Package size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg">No products found.</p>
        <p className="text-sm mt-1">Run the seed script to add demo data.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
