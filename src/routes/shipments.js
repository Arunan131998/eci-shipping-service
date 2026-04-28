const express = require('express');
const { pool } = require('../db/pool');
const { shipmentsCreatedTotal } = require('../metrics');

async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);
    return { ok: response.ok, status: response.status };
  } catch (_) {
    return { ok: false, status: 0 };
  }
}

const router = express.Router();

function parsePagination(query) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '10', 10), 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

router.post('/', async (req, res, next) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) {
    return next({ status: 400, code: 'VALIDATION_ERROR', message: 'Idempotency-Key header is required' });
  }

  const { order_id, carrier } = req.body;
  if (!order_id || !carrier) {
    return next({ status: 400, code: 'VALIDATION_ERROR', message: 'order_id and carrier are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM shipments WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return res.status(200).json(existing.rows[0]);
    }

    const trackingNo = `TRK-${Date.now()}`;

    const inserted = await client.query(
      `INSERT INTO shipments (order_id, carrier, status, tracking_no, idempotency_key)
       VALUES ($1, $2, 'PENDING', $3, $4)
       RETURNING *`,
      [order_id, carrier, trackingNo, idempotencyKey]
    );

    await client.query('COMMIT');
    shipmentsCreatedTotal.inc();
    return res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.patch('/:shipmentId/status', async (req, res, next) => {
  const { shipmentId } = req.params;
  const { status } = req.body;
  const validStatuses = ['PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

  if (!validStatuses.includes(status)) {
    return next({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid shipment status' });
  }

  const shippedAt = status === 'SHIPPED' ? 'NOW()' : 'shipped_at';
  const deliveredAt = status === 'DELIVERED' ? 'NOW()' : 'delivered_at';

  try {
    const query = `
      UPDATE shipments
      SET status = $1,
          shipped_at = ${shippedAt},
          delivered_at = ${deliveredAt},
          updated_at = NOW()
      WHERE shipment_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [status, shipmentId]);

    if (result.rows.length === 0) {
      return next({ status: 404, code: 'SHIPMENT_NOT_FOUND', message: 'Shipment not found' });
    }

    const shipment = result.rows[0];

    // Callback Order service
    const orderCallbackUrl = process.env.ORDER_CALLBACK_URL;
    if (orderCallbackUrl) {
      safeFetch(`${orderCallbackUrl}/${shipment.order_id}/events/shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': req.correlationId || shipment.shipment_id },
        body: JSON.stringify({ shipment_id: shipment.shipment_id, shipment_status: status })
      });
    }

    // Notify on SHIPPED and DELIVERED
    const notifBaseUrl = process.env.NOTIFICATION_BASE_URL;
    if (notifBaseUrl && (status === 'SHIPPED' || status === 'DELIVERED')) {
      const eventType = status === 'SHIPPED' ? 'SHIPMENT_SHIPPED' : 'SHIPMENT_DELIVERED';
      safeFetch(`${notifBaseUrl}/v1/notifications/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': req.correlationId || shipment.shipment_id },
        body: JSON.stringify({ event_type: eventType, order_id: shipment.order_id })
      });
    }

    return res.json(shipment);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  const { page, limit, offset } = parsePagination(req.query);
  const filters = [];
  const params = [];

  if (req.query.status) {
    params.push(req.query.status);
    filters.push(`status = $${params.length}`);
  }

  if (req.query.order_id) {
    params.push(req.query.order_id);
    filters.push(`order_id = $${params.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const countQuery = `SELECT COUNT(*)::INT AS total FROM shipments ${whereClause}`;
    const dataQuery = `
      SELECT * FROM shipments
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const totalResult = await pool.query(countQuery, params);
    const dataResult = await pool.query(dataQuery, [...params, limit, offset]);

    return res.json({
      page,
      limit,
      total: totalResult.rows[0].total,
      items: dataResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
