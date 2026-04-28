# Shipping Service

ECI Shipping microservice managing shipment creation and delivery status lifecycle.

## Features
- Versioned API: `/v1/shipments`
- Idempotent shipment creation via `Idempotency-Key`
- Shipment status updates (`PENDING`, `SHIPPED`, `DELIVERED`, `CANCELLED`)
- Standard error format: `code`, `message`, `correlationId`
- Pagination/filtering on list API
- Callbacks to Order and Notification services
- OpenAPI docs at `/docs`
- Metrics at `/metrics`

## Quick Start

### Option 1: Local Development (No Docker)
1. Ensure PostgreSQL is running and `shipping_db` exists.
2. Create `.env` from `.env.example` (required: ORDER_CALLBACK_URL, NOTIFICATION_BASE_URL for callbacks).
3. Run:
   ```bash
   npm install
   npm run seed  # optional - loads data/eci_shipments_indian.csv
   npm start
   ```
4. Service runs on `http://localhost:3005`

### Option 2: Docker (Single Service)
1. Build the Docker image:
   ```bash
   docker build -t eci-shipping-service:latest .
   ```
2. Create Docker network (if not exists):
   ```bash
   docker network create eci-net
   ```
3. Run PostgreSQL container:
   ```bash
   docker run -d --name shipping-db --network eci-net \
     -e POSTGRES_USER=user \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=shipping_db \
     -p 5435:5432 \
     postgres:16-alpine
   ```
4. Run the service container:
   ```bash
   docker run -d --name shipping-service --network eci-net \
     -e DATABASE_URL=postgres://user:password@shipping-db:5432/shipping_db \
     -e APP_PORT=3005 \
     -e ORDER_CALLBACK_URL=http://order-service:3003 \
     -e NOTIFICATION_BASE_URL=http://notification-service:3006 \
     -p 3005:3005 \
     eci-shipping-service:latest
   ```
5. Verify running:
   ```bash
   curl http://localhost:3005/health
   ```

### Option 3: Docker Compose (Full Stack - from root directory)
From the `FullApplication/` root directory:
```bash
# Build all services and start the stack
docker compose -f docker-compose.yml up --build -d

# View logs
docker compose -f docker-compose.yml logs -f shipping-service

# Stop all services
docker compose -f docker-compose.yml down
```

### Seeding (PowerShell)
Run from the `FullApplication/` root directory:
```powershell
# Watch automatic seed progress
docker compose -f docker-compose.yml logs -f seed

# Rerun the seed job manually
docker compose -f docker-compose.yml up --build seed

# Seed only shipping service
docker compose -f docker-compose.yml exec shipping-service npm run seed
```

## Important Endpoints
- `GET /health` — Health check
- `POST /v1/shipments` — Create shipment (idempotent)
- `PATCH /v1/shipments/{shipmentId}/status` — Update shipment status (PENDING→SHIPPED→DELIVERED or CANCELLED)
- `GET /v1/shipments?page=1&limit=10&order_id=ORD-1001` — List shipments with pagination/filtering
- `GET /docs` — OpenAPI Swagger UI
- `GET /metrics` — Prometheus metrics

## Postman Testing
Import from `postman/` directory:
- `shipping-service.postman_collection.json`
- `shipping-service.postman_environment.json`

Select environment: `ECI Shipping Local`

#### Test Runner Order
1. Health - Shipping
2. Create Shipment (Idempotent)
3. Update Shipment Status
4. List Shipments

The collection auto-saves `shipmentId` from create response for status update flow.

## Kubernetes Deployment (Minikube)

### Prerequisites
- Minikube running: `minikube start`
- kubectl configured
- Order service deployed (for callbacks)
- Notification service deployed (for callbacks)
- Image available in Minikube

### Deployment Steps

1. **Build image for Minikube**:
   ```bash
   eval $(minikube docker-env)
   docker build -t eci-shipping-service:latest .
   ```

2. **Apply Kubernetes manifests** (from service root):
   ```bash
   kubectl apply -f k8s/shipping-config.yaml
   kubectl apply -f k8s/shipping-db.yaml
   kubectl rollout status statefulset/shipping-db
   kubectl apply -f k8s/shipping-service.yaml
   kubectl rollout status deployment/shipping-service
   ```

3. **Verify deployment**:
   ```bash
   kubectl get pods -l app=shipping-service
   kubectl get svc shipping-service
   kubectl logs -l app=shipping-service -f
   ```

4. **Access the service** (port-forward):
   ```bash
   kubectl port-forward svc/shipping-service 3005:3005
   curl http://localhost:3005/health
   # Open browser: http://localhost:3005/docs
   ```

5. **Cleanup**:
   ```bash
   kubectl delete -f k8s/shipping-service.yaml
   kubectl delete -f k8s/shipping-db.yaml
   kubectl delete -f k8s/shipping-config.yaml
   ```

## Inter-Service Callbacks
Shipping service calls:
- **Order service**: `POST /v1/orders/{orderId}/events/shipment` (when status changes)
- **Notification service**: `POST /v1/notifications/events` (SHIPMENT_SHIPPED, SHIPMENT_DELIVERED)
