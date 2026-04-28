require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { pool } = require('../src/db/pool');

function datasetPath() {
  return process.env.ECI_DATASET_DIR || path.resolve(__dirname, '..', 'data');
}

function loadCsv(fileName) {
  const filePath = path.join(datasetPath(), fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });
}

function safeTimestamp(value) {
  if (!value) {
    return null;
  }
  return value;
}

async function seedShipments() {
  const rows = loadCsv('eci_shipments_indian.csv');

  for (const row of rows) {
    const orderId = String(row.order_id);
    const carrier = row.carrier || 'UNKNOWN';
    const status = row.status || 'PENDING';
    const trackingNo = row.tracking_no || `SEED-TRK-${row.shipment_id}`;
    const shippedAt = safeTimestamp(row.shipped_at);
    const deliveredAt = safeTimestamp(row.delivered_at);

    await pool.query(
      `INSERT INTO shipments
       (order_id, carrier, status, tracking_no, idempotency_key, shipped_at, delivered_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamp, $7::timestamp, NOW(), NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        orderId,
        carrier,
        status,
        trackingNo,
        `seed-shipment-${row.shipment_id}`,
        shippedAt,
        deliveredAt
      ]
    );
  }

  console.log(`Seeded shipments rows processed: ${rows.length}`);
}

async function run() {
  try {
    await seedShipments();
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Shipping seed failed:', error.message);
  process.exit(1);
});
