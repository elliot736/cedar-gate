// ── cedar-gate Public API ────────────────────────────────────────────

// Config
export { loadConfig, DEFAULT_CONFIG } from "./config.js";
export type { GatewayConfig } from "./config.js";

// Schema
export { GATEWAY_SCHEMA, ACTIONS, ENTITY_TYPES } from "./schema/gateway-schema.js";
export {
  buildPrincipal,
  buildEndpointUID,
  buildContext,
  buildEndpointEntity,
  buildServiceEntity,
  buildTenantEntity,
  buildUserEntity,
  buildRateLimitTierEntity,
} from "./schema/entity-builder.js";

// Pipeline
export { composePipeline } from "./pipeline/pipeline.js";
export type {
  GatewayRequest,
  GatewayResponse,
  GatewayMiddleware,
  NextFunction,
} from "./pipeline/types.js";

// Policies
export { PolicyStore } from "./policies/policy-store.js";
export { PolicyEvaluator } from "./policies/policy-evaluator.js";
export { loadPoliciesFromDir, loadEntitiesFromFile } from "./policies/policy-loader.js";
export { HotReloader } from "./policies/hot-reload.js";
export type { GatewayAction } from "./policies/policy-evaluator.js";

// Access Control
export { evaluateAccess } from "./authz/access-evaluator.js";
export type { AccessResult } from "./authz/access-evaluator.js";

// Routing
export { resolveRoute } from "./routing/router.js";
export { proxyRequest } from "./routing/proxy.js";
export type { BackendTarget, ResolvedRoute } from "./routing/router.js";

// Rate Limiting
export { PolicyRateLimiter } from "./ratelimit/policy-rate-limiter.js";
export { LimiterRegistry } from "./ratelimit/limiter-registry.js";
export {
  TokenBucketLimiter,
  SlidingWindowLimiter,
} from "./ratelimit/strategies.js";
export type {
  RateLimiter,
  RateLimitResult,
  TokenBucketConfig,
  SlidingWindowConfig,
} from "./ratelimit/strategies.js";
export type { RateLimitTierConfig } from "./ratelimit/limiter-registry.js";

// Observability
export { createLogger } from "./observability/logger.js";
export { MetricsRegistry } from "./observability/metrics.js";
export { generateRequestId, durationSeconds } from "./observability/tracing.js";

// Gateway
export { createGatewayHandler } from "./gateway.js";
