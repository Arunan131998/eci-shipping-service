# Shipping Service

ECI Shipping microservice managing shipment creation and delivery status lifecycle.

## Features
- Versioned API: `/v1/shipments`
- Idempotent shipment creation via `Idempotency-Key`
- Shipment status updates (`PENDING`, `SHIPPED`, `DELIVERED`, `CANCELLED`)
- Standard error format: `code`, `message`, `correlationId`
- Pagination/filtering on list API
- OpenAPI docs at `/docs`
- Metrics at `/metrics`

## Local Run (No Docker)
1. Ensure PostgreSQL is running and `shipping_db` exists.
2. Create `.env` from `.env.example`.
3. Install and run:
   - `npm install`
   - `npm run seed` (optional, uses `data/eci_shipments_indian.csv`)
   - `npm start`

## Important Endpoints
- `GET /health`
- `POST /v1/shipments`
- `PATCH /v1/shipments/{shipmentId}/status`
- `GET /v1/shipments?page=1&limit=10&order_id=ORD-1001`

## Postman
Import:
- `postman/shipping-service.postman_collection.json`
- `postman/shipping-service.postman_environment.json`

Select environment: `ECI Shipping Local`

### Runner Order
1. `Health - Shipping`
2. `Create Shipment (Idempotent)`
3. `Update Shipment Status`
4. `List Shipments`

The collection auto-saves `shipmentId` from create response for status update flow.

## Kubernetes (Minikube)
Apply manifests:
- `k8s/shipping-config.yaml`
- `k8s/shipping-db.yaml`
- `k8s/shipping-service.yaml`
