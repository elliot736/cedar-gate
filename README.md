# cedar-gate

[![CI](https://github.com/elliot736/cedar-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/elliot736/cedar-gate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org)

A lightweight API gateway where **routing, rate limiting, and access control are all expressed as [Cedar](https://www.cedarpolicy.com) policies**. No YAML. No JSON config. Just Cedar.

Cedar policies give you a formally-defined, auditable, hot-reloadable configuration language swap routing rules without restarting the gateway, enforce per-tenant rate limits through policy hierarchy, and block requests with a single `forbid` statement.

## Why Cedar for a gateway?

Traditional API gateways use YAML/JSON for routing and separate systems for auth and rate limiting. cedar-gate unifies all three concerns under one policy language:

| Concern            | Traditional gateway                 | cedar-gate                                                                                                                        |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Routing**        | YAML route tables                   | `permit(principal, action == Action::"route", resource == Gateway::Endpoint::"GET:/api/users")`                                   |
| **Access control** | Middleware chain, OPA, or hardcoded | `forbid(principal, action == Action::"access", resource) when { context.tenantStatus == "suspended" }`                            |
| **Rate limiting**  | Config per endpoint                 | `permit(principal in Gateway::Tenant::"acme", action == Action::"ratelimit", resource == Gateway::Endpoint::"rate-tier:premium")` |

This means one language, one evaluation engine, one place to audit. Cedar's `forbid` always overrides `permit`, so safety constraints can't be accidentally bypassed by a routing rule.

## Quick start

```bash
# Clone and install
git clone https://github.com/elliot736/cedar-gate.git
cd cedar-gate
npm install
npm run build

# Start with example policies
POLICIES_DIR=./policies ENTITIES_FILE=./entities.json npm start
```

The gateway listens on `:8080` (traffic) and `:8081` (admin/metrics).

```bash
# Test a request
curl http://localhost:8080/api/users

# Check metrics
curl http://localhost:8081/metrics

# View loaded policies
curl http://localhost:8081/admin/policies

# Health check
curl http://localhost:8081/health
```

### Docker

```bash
docker build -t cedar-gate .
docker run -p 8080:8080 -p 8081:8081 \
  -v $(pwd)/policies:/app/policies \
  -v $(pwd)/entities.json:/app/entities.json \
  cedar-gate
```

## Architecture

```
                            ┌─────────────────────────┐
                            │      Cedar Policies      │
                            │  (access, route, rate)   │
                            └────────────┬────────────┘
                                         │ hot-reload
                                         ▼
  HTTP Request ──► ┌──────────────────────────────────────────┐
                   │              cedar-gate                   │
                   │                                          │
                   │  ┌─────────┐  ┌──────────┐  ┌────────┐  │     ┌──────────┐
                   │  │ Access  │─►│   Rate   │─►│ Route  │──│────►│ Backend  │
                   │  │ Control │  │ Limiting │  │Resolve │  │     │ Service  │
                   │  └─────────┘  └──────────┘  └────────┘  │     └──────────┘
                   │       │            │             │        │
                   │       ▼            ▼             ▼        │
                   │           Cedar Evaluator                 │
                   │      (@cedar-policy/cedar-wasm)           │
                   └──────────────────────────────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              │  Observability       │
                              │  • Structured logs   │
                              │  • Prometheus metrics│
                              │  • Request tracing   │
                              └─────────────────────┘
```

### Request lifecycle

Every request goes through three Cedar policy evaluations:

1. **Access control** `Action::"access"` Is this principal allowed to reach this endpoint? → `403 Forbidden` if denied
2. **Rate limiting** `Action::"ratelimit"` Which rate limit tier applies? → `429 Too Many Requests` if exceeded
3. **Routing** `Action::"route"` Which backend serves this endpoint? → `404 Not Found` if no route matches
4. **Proxy** Forward to the resolved backend via streaming `node:http` reverse proxy

Each evaluation uses the same Cedar engine, same entity store, same policy set. The only difference is the `action` in the Cedar request.

## Cedar policy model

### Entity types

```
Gateway::User       { role?: String }              → parent: Gateway::Tenant
Gateway::ApiKey     { tenantId: String }           → parent: Gateway::Tenant
Gateway::Tenant     { tier: String, plan: String }
Gateway::Anonymous  {}
Gateway::Endpoint   { path: String, method: String, backend: String } → parent: Gateway::Service
Gateway::Service    { name: String, url: String }
```

The `→ parent` arrows define Cedar's entity hierarchy. A `User` that belongs to `Tenant::"acme"` inherits all policies that apply to `Tenant::"acme"` this is how tenant-scoped policies work without duplicating rules.

### Writing policies

**Route an endpoint to a backend:**

```cedar
permit(
  principal,
  action == Action::"route",
  resource == Gateway::Endpoint::"GET:/api/users"
);
```

The backend URL comes from the `Endpoint` entity's `backend` attribute in the entity store not the policy itself. Policies decide _if_ a route is allowed; entities define _where_ it goes.

**Restrict access by role:**

```cedar
permit(
  principal is Gateway::User,
  action == Action::"access",
  resource in Gateway::Service::"admin-service"
) when { principal.role == "admin" };
```

**Block a tenant:**

```cedar
forbid(
  principal,
  action == Action::"access",
  resource
) when { context.tenantStatus == "suspended" };
```

Cedar's `forbid` always wins over `permit`, so this blocks the tenant regardless of any other access policies.

**Per-tenant rate limits:**

```cedar
// Everyone gets standard tier (100 req/min)
permit(
  principal,
  action == Action::"ratelimit",
  resource == Gateway::Endpoint::"rate-tier:standard"
);

// Enterprise tenants get premium tier (1000 req/min)
permit(
  principal is Gateway::Tenant,
  action == Action::"ratelimit",
  resource == Gateway::Endpoint::"rate-tier:premium"
) when { principal.tier == "enterprise" };
```

Rate limit tiers are defined as entities with configuration attributes:

```json
{
  "uid": { "type": "Gateway::Endpoint", "id": "rate-tier:standard" },
  "attrs": { "strategy": "sliding-window", "capacity": 100, "windowMs": 60000 }
}
```

The gateway evaluates which tier is permitted for the principal, reads the config from the entity, and applies the appropriate limiter (token bucket or sliding window).

## Configuration

cedar-gate is configured via environment variables:

| Variable        | Default      | Description                         |
| --------------- | ------------ | ----------------------------------- |
| `PORT`          | `8080`       | Gateway traffic port                |
| `ADMIN_PORT`    | `8081`       | Admin API and metrics port          |
| `POLICIES_DIR`  | `./policies` | Directory containing `.cedar` files |
| `ENTITIES_FILE` |              | JSON file with entity definitions   |
| `HOT_RELOAD`    | `true`       | Watch policies dir for changes      |
| `LOG_LEVEL`     | `info`       | `debug`, `info`, `warn`, or `error` |

### Entity store format

The entities file is a JSON array of Cedar entities:

```json
[
  {
    "uid": { "type": "Gateway::Service", "id": "users-api" },
    "attrs": { "name": "users-api", "url": "http://users-service:3000" },
    "parents": []
  },
  {
    "uid": { "type": "Gateway::Endpoint", "id": "GET:/api/users" },
    "attrs": {
      "path": "/api/users",
      "method": "GET",
      "backend": "http://users-service:3000"
    },
    "parents": [{ "type": "Gateway::Service", "id": "users-api" }]
  },
  {
    "uid": { "type": "Gateway::Tenant", "id": "acme" },
    "attrs": { "tier": "enterprise", "plan": "pro" },
    "parents": []
  }
]
```

## Hot reload

Edit any `.cedar` file in the policies directory and cedar-gate picks up the change within 300ms no restart needed.

How it works:

- A `node:fs` watcher monitors the policies directory
- Changes are debounced (300ms) to handle multi-file saves
- On change: re-parse all `.cedar` files → validate → atomically swap the `Authorizer` reference
- In-flight requests finish with the old policies; new requests use the new ones
- On parse error: log the error, **keep the old policies** (never serve with broken config)

You can also trigger a reload via the admin API:

```bash
curl -X POST http://localhost:8081/admin/policies/reload
```

### Atomic swap (no locks)

The hot-reload uses a single-reference swap: the `PolicyStore` holds a reference to an `Authorizer` instance. On reload, a new `Authorizer` is constructed and the reference is replaced in a single assignment. JavaScript's single-threaded event loop guarantees this is atomic no mutexes, no read-write locks. This is the same pattern used by Envoy and HAProxy for configuration updates.

## Admin API

All admin endpoints are served on the admin port (default: `8081`).

| Method | Path                     | Description                            |
| ------ | ------------------------ | -------------------------------------- |
| `GET`  | `/health`                | Health check with policy/entity counts |
| `GET`  | `/metrics`               | Prometheus metrics                     |
| `GET`  | `/admin/policies`        | List loaded policies                   |
| `POST` | `/admin/policies`        | Add policies from Cedar text           |
| `POST` | `/admin/policies/reload` | Trigger policy reload from disk        |
| `GET`  | `/admin/entities`        | View entity store                      |
| `PUT`  | `/admin/entities`        | Replace entity store                   |

### Add a policy at runtime

```bash
curl -X POST http://localhost:8081/admin/policies \
  -H "Content-Type: application/json" \
  -d '{"policyText": "forbid(principal, action == Action::\"access\", resource) when { context.sourceIp like \"10.0.0.*\" };"}'
```

## Observability

### Metrics

Prometheus-format metrics at `GET /metrics` on the admin port:

```
gateway_requests_total{method="GET",status="200",tenant="acme"} 142
gateway_request_duration_seconds_bucket{method="GET",le="0.1"} 130
gateway_policy_evaluation_seconds_bucket{action="access",le="0.005"} 142
gateway_rate_limit_hits_total{tenant="acme",tier="premium"} 3
gateway_backend_request_seconds_bucket{backend="http://users:3000",le="0.5"} 139
gateway_policy_count 12
gateway_entity_count 8
gateway_policy_reload_total 2
```

The metrics registry is a custom Prometheus text format serializer no `prom-client` dependency. Supports counters, gauges, and histograms with configurable buckets.

### Structured logging

JSON-structured logs via [pino](https://github.com/pinojs/pino):

```json
{
  "level": "info",
  "time": "2026-03-19T10:00:00.000Z",
  "requestId": "m3x1k-0001-a7f2",
  "method": "GET",
  "path": "/api/users",
  "status": 200,
  "backend": "http://users:3000",
  "duration": 0.023
}
```

Every log line includes the `requestId` for correlation. The request ID is forwarded to backends as `X-Request-Id`.

### Request tracing

- Generates a unique ID per request (or accepts the client's `X-Request-Id` header)
- Forwards the ID to backends as `X-Request-Id`
- Includes the ID in all response headers and log lines
- Sub-millisecond duration tracking via `process.hrtime.bigint()`

## Rate limiting strategies

cedar-gate includes two rate limiting strategies, selected per-tier via entity attributes:

### Token bucket

Allows controlled bursts up to capacity, then sustains a steady rate. Good for APIs that need to handle occasional spikes.

```json
{ "strategy": "token-bucket", "capacity": 1000, "refillRate": 20 }
```

This allows a burst of 1000 requests, then 20 requests/second sustained.

### Sliding window

Smooth rate limiting without bursts. Uses a weighted two-window approximation for memory efficiency.

```json
{ "strategy": "sliding-window", "capacity": 100, "windowMs": 60000 }
```

This allows 100 requests per rolling 60-second window.

Both strategies are per-key (composite of tenant + endpoint) and self-cleaning (stale entries are garbage collected).

## Multi-tenant design

Multi-tenancy is first-class in cedar-gate, not bolted on:

- **Tenant resolution**: `X-Tenant-Id` header on incoming requests
- **Policy hierarchy**: `User → Tenant` in Cedar's entity hierarchy policies on a `Tenant` automatically apply to all its `User`s
- **Rate limit isolation**: Each tenant gets its own rate limit counters, even when sharing a tier
- **Per-tenant routing**: Route different tenants to different backends via Cedar policies
- **Tenant blocking**: A single `forbid` policy suspends an entire tenant

```cedar
// Route tenant "acme" to their dedicated backend
permit(
  principal in Gateway::Tenant::"acme",
  action == Action::"route",
  resource in Gateway::Service::"acme-dedicated"
);
```

## Project structure

```
cedar-gate/
  src/
    index.ts                    # Public API exports
    server.ts                   # CLI entry point
    gateway.ts                  # Request handler orchestrator
    config.ts                   # Configuration types + loader
    schema/
      gateway-schema.ts         # Cedar entity types and actions
      entity-builder.ts         # Build Cedar entities from HTTP requests
    policies/
      policy-store.ts           # Atomic policy store with change notifications
      policy-evaluator.ts       # Cedar evaluation for access/route/ratelimit
      policy-loader.ts          # Load .cedar files from disk
      hot-reload.ts             # File watcher with debounced reload
    routing/
      router.ts                 # Policy-driven route resolution
      proxy.ts                  # Streaming HTTP reverse proxy
    ratelimit/
      strategies.ts             # Token bucket + sliding window
      limiter-registry.ts       # Cache limiter instances by tier config
      policy-rate-limiter.ts    # Cedar → rate limit tier resolution
    authz/
      access-evaluator.ts       # Cedar access control evaluation
    admin/
      admin-router.ts           # Admin API server
      admin-handlers.ts         # CRUD policies, metrics, health
    observability/
      logger.ts                 # pino structured logger
      metrics.ts                # Custom Prometheus metrics registry
      tracing.ts                # Request ID generation + duration tracking
    pipeline/
      pipeline.ts               # Middleware composition
      types.ts                  # GatewayRequest, GatewayResponse types
  tests/                        # Mirrors src/ structure
  policies/                     # Example Cedar policies
  entities.json                 # Example entity store
```

## Dependencies

cedar-gate has exactly **2 runtime dependencies**:

- [`@cedar-policy/cedar-wasm`](https://github.com/cedar-policy/cedar) AWS's official Cedar policy engine compiled to WebAssembly
- [`pino`](https://github.com/pinojs/pino) Structured logging

Everything else uses Node.js built-ins: `node:http` for the server and reverse proxy, `node:fs` for file watching, custom code for Prometheus metrics serialization.

## Development

```bash
npm install
npm run typecheck    # Type-check without emitting
npm test             # Run tests once
npm run test:watch   # Watch mode
npm run build        # Compile to dist/
npm start            # Start the gateway
```

## License

MIT
