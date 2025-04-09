import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { composePipeline } from "../../src/pipeline/pipeline.js";
import type { GatewayRequest, GatewayResponse, GatewayMiddleware } from "../../src/pipeline/types.js";

function makeReq(): GatewayRequest {
  return {
    raw: {} as IncomingMessage,
    id: "test",
    method: "GET",
    path: "/",
    query: {},
    headers: {},
    sourceIp: "127.0.0.1",
    startTime: 0n,
  } as GatewayRequest;
}

function makeRes(): GatewayResponse {
  return {
    raw: {} as ServerResponse,
    statusCode: 200,
    headers: {},
  };
}

describe("composePipeline", () => {
  it("executes middlewares in order", async () => {
    const order: number[] = [];

    const m1: GatewayMiddleware = async (_req, _res, next) => {
      order.push(1);
      await next();
    };
    const m2: GatewayMiddleware = async (_req, _res, next) => {
      order.push(2);
      await next();
    };
    const m3: GatewayMiddleware = async (_req, _res, next) => {
      order.push(3);
      await next();
    };

    const pipeline = composePipeline([m1, m2, m3]);
    await pipeline(makeReq(), makeRes(), async () => {});

    expect(order).toEqual([1, 2, 3]);
  });

  it("short-circuits when middleware does not call next", async () => {
    const order: number[] = [];

    const m1: GatewayMiddleware = async (_req, _res, next) => {
      order.push(1);
      await next();
    };
    const m2: GatewayMiddleware = async () => {
      order.push(2);
      // Does not call next
    };
    const m3: GatewayMiddleware = async (_req, _res, next) => {
      order.push(3);
      await next();
    };

    const pipeline = composePipeline([m1, m2, m3]);
    await pipeline(makeReq(), makeRes(), async () => {});

    expect(order).toEqual([1, 2]);
  });

  it("calls the final next function after all middlewares", async () => {
    const finalNext = vi.fn();

    const m1: GatewayMiddleware = async (_req, _res, next) => {
      await next();
    };

    const pipeline = composePipeline([m1]);
    await pipeline(makeReq(), makeRes(), finalNext);

    expect(finalNext).toHaveBeenCalledOnce();
  });

  it("propagates errors from middleware", async () => {
    const m1: GatewayMiddleware = async () => {
      throw new Error("test error");
    };

    const pipeline = composePipeline([m1]);
    await expect(pipeline(makeReq(), makeRes(), async () => {})).rejects.toThrow("test error");
  });

  it("detects multiple next() calls", async () => {
    const m1: GatewayMiddleware = async (_req, _res, next) => {
      await next();
      await next();
    };

    const pipeline = composePipeline([m1]);
    await expect(pipeline(makeReq(), makeRes(), async () => {})).rejects.toThrow("next() called multiple times");
  });
});
