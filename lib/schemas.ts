import { z } from "zod";

export const CreateReservationSchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
  warehouseId: z.string().min(1, "Warehouse ID is required"),
  quantity: z.number().int().positive("Quantity must be a positive integer"),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;

export const ReservationStatusSchema = z.enum(["PENDING", "CONFIRMED", "RELEASED"]);

export const ReservationSchema = z.object({
  id: z.string(),
  stockLevelId: z.string(),
  quantity: z.number(),
  status: ReservationStatusSchema,
  expiresAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  releasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type ReservationData = z.infer<typeof ReservationSchema>;

export const ProductWithStockSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sku: z.string(),
  price: z.number(),
  stockLevels: z.array(
    z.object({
      id: z.string(),
      warehouseId: z.string(),
      totalUnits: z.number(),
      reserved: z.number(),
      available: z.number(),
      warehouse: z.object({
        id: z.string(),
        name: z.string(),
        location: z.string(),
      }),
    })
  ),
});

export type ProductWithStock = z.infer<typeof ProductWithStockSchema>;
