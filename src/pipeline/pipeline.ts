// ── Middleware Pipeline ──────────────────────────────────────────────

import type { GatewayMiddleware, GatewayRequest, GatewayResponse } from "./types.js";

/**
 * Compose an ordered list of middleware into a single handler.
 * Each middleware calls next() to pass control to the next in the chain.
 * If a middleware does not call next(), the chain short-circuits.
 */
export function composePipeline(
  middlewares: GatewayMiddleware[],
): GatewayMiddleware {
  return async (req: GatewayRequest, res: GatewayResponse, next) => {
    let index = -1;

    async function dispatch(i: number): Promise<void> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      if (i >= middlewares.length) {
        await next();
        return;
      }

      const middleware = middlewares[i]!;
      await middleware(req, res, () => dispatch(i + 1));
    }

    await dispatch(0);
  };
}
