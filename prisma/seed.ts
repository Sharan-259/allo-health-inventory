import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Clean up existing data
  await prisma.idempotencyKey.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  // Create warehouses
  const [mumbai, delhi, bangalore] = await Promise.all([
    prisma.warehouse.create({
      data: { name: "Mumbai Central", location: "Mumbai, Maharashtra" },
    }),
    prisma.warehouse.create({
      data: { name: "Delhi North", location: "New Delhi, Delhi" },
    }),
    prisma.warehouse.create({
      data: { name: "Bangalore Tech Park", location: "Bangalore, Karnataka" },
    }),
  ]);

  // Create products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: "Wireless Noise-Cancelling Headphones",
        description: "Premium over-ear headphones with 30hr battery life",
        sku: "WH-1000XM5",
        price: 24999,
      },
    }),
    prisma.product.create({
      data: {
        name: "Mechanical Keyboard",
        description: "Compact TKL layout with Cherry MX switches",
        sku: "KB-TKL-MX",
        price: 8499,
      },
    }),
    prisma.product.create({
      data: {
        name: "4K Webcam",
        description: "Ultra HD webcam with autofocus and ring light",
        sku: "CAM-4K-AF",
        price: 5999,
      },
    }),
    prisma.product.create({
      data: {
        name: "USB-C Hub (7-in-1)",
        description: "7 ports: HDMI 4K, 3x USB-A, SD card, USB-C PD",
        sku: "HUB-7IN1-C",
        price: 2499,
      },
    }),
    prisma.product.create({
      data: {
        name: "Ergonomic Mouse",
        description: "Vertical design, wireless, 3-device Bluetooth",
        sku: "MOUSE-ERGO-V",
        price: 3299,
      },
    }),
  ]);

  // Create stock levels — deliberately keep some low to demo 409s
  const stockData = [
    // Headphones
    { product: products[0], warehouse: mumbai, total: 10 },
    { product: products[0], warehouse: delhi, total: 5 },
    { product: products[0], warehouse: bangalore, total: 1 }, // scarce!

    // Keyboard
    { product: products[1], warehouse: mumbai, total: 25 },
    { product: products[1], warehouse: delhi, total: 3 },
    { product: products[1], warehouse: bangalore, total: 8 },

    // Webcam
    { product: products[2], warehouse: mumbai, total: 2 }, // scarce!
    { product: products[2], warehouse: delhi, total: 15 },
    { product: products[2], warehouse: bangalore, total: 0 }, // out of stock

    // Hub
    { product: products[3], warehouse: mumbai, total: 50 },
    { product: products[3], warehouse: delhi, total: 30 },
    { product: products[3], warehouse: bangalore, total: 20 },

    // Mouse
    { product: products[4], warehouse: mumbai, total: 1 }, // scarce!
    { product: products[4], warehouse: delhi, total: 7 },
    { product: products[4], warehouse: bangalore, total: 12 },
  ];

  for (const { product, warehouse, total } of stockData) {
    await prisma.stockLevel.create({
      data: {
        productId: product.id,
        warehouseId: warehouse.id,
        totalUnits: total,
        reserved: 0,
      },
    });
  }

  console.log(`✅ Seeded:`);
  console.log(`   - 3 warehouses`);
  console.log(`   - ${products.length} products`);
  console.log(`   - ${stockData.length} stock levels`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
