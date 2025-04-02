// ── Pipeline Types ───────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from "node:http";
import type { EntityUid } from "@cedar-policy/cedar-wasm";

export interface GatewayRequest {
  raw: IncomingMessage;
  id: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  sourceIp: string;
  tenantId?: string;
  principal?: EntityUid;
  startTime: bigint;
}

export interface GatewayResponse {
  raw: ServerResponse;
  statusCode: number;
  headers: Record<string, string>;
}

export type NextFunction = () => Promise<void>;

export type GatewayMiddleware = (
  req: GatewayRequest,
  res: GatewayResponse,
  next: NextFunction,
) => Promise<void>;
