import {
  ErrorCodes,
  FutureMethods,
  MethodsSchema,
  type MethodName,
} from "@extlens/protocol";
import { buildProfile } from "./profile.js";
import type { Backend } from "./backend.js";

/**
 * RPC dispatch: validate (zod) -> backend -> result or error. The SDK owns the
 * protocol; hosts never see raw messages. Every backend result is validated
 * against its method's result schema before it goes out on the wire.
 */

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type RpcResponse =
  | { result: unknown }
  | { error: { code: number; message: string } };

interface RpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

function formatZodError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function validateResult(method: MethodName, result: unknown): void {
  const def = MethodsSchema[method];
  def.result.parse(result);
}

export async function dispatch(backend: Backend, request: RpcRequest): Promise<RpcResponse> {
  const def = MethodsSchema[request.method as MethodName];
  if (!def) {
    const message = (FutureMethods as readonly string[]).includes(request.method)
      ? `method ${request.method} is documented but not implemented in protocol v1`
      : `unknown method: ${request.method}`;
    return { error: { code: ErrorCodes.METHOD_NOT_FOUND, message } };
  }

  let params: unknown;
  try {
    params = def.params
      ? def.params.parse(request.params === undefined ? {} : request.params)
      : undefined;
  } catch (error) {
    return {
      error: {
        code: ErrorCodes.INVALID_PARAMS,
        message: `invalid params: ${formatZodError(error)}`,
      },
    };
  }

  try {
    let result: unknown;
    switch (request.method as MethodName) {
      case "ping":
        result = { ok: true };
        break;
      case "extensions.list": {
        result = await backend.listExtensions(params as never);
        break;
      }
      case "extensions.get": {
        const { id } = params as { id: string };
        const got = await backend.getExtension(id);
        if (!got) throw new RpcError(ErrorCodes.UNKNOWN_EXTENSION, `unknown extension id: ${id}`);
        result = { extension: buildProfile(got.source, got.profile) };
        break;
      }
      case "extensions.files": {
        const { id } = params as { id: string };
        const files = await backend.getFiles(id);
        if (!files) throw new RpcError(ErrorCodes.UNKNOWN_EXTENSION, `unknown extension id: ${id}`);
        result = { files };
        break;
      }
      case "reports.get": {
        const { extensionId } = params as { extensionId: string };
        result = { report: await backend.getReport(extensionId) };
        break;
      }
      case "reports.list": {
        if (!backend.listReports) {
          throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "this host cannot enumerate its reports");
        }
        result = { reports: await backend.listReports() };
        break;
      }
      case "reports.submit": {
        const { report } = params as { report: never };
        const id = await backend.submitReport(report);
        result = { id };
        break;
      }
      case "host.status": {
        const host = backend.host;
        if (!host) {
          throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "host lifecycle not supported by this backend");
        }
        result = { status: await host.getStatus() };
        break;
      }
      case "host.start": {
        const host = backend.host;
        if (!host) {
          throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "host lifecycle not supported by this backend");
        }
        const { id } = params as { id: string };
        result = { status: await host.start(id) };
        break;
      }
      case "host.startAll": {
        const host = backend.host;
        if (!host || !host.startAll) {
          throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "host.startAll not supported by this backend");
        }
        result = { status: await host.startAll() };
        break;
      }
      case "host.stop": {
        const host = backend.host;
        if (!host) {
          throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "host lifecycle not supported by this backend");
        }
        result = { status: await host.stop() };
        break;
      }
      case "host.log": {
        const host = backend.host;
        if (!host) {
          throw new RpcError(ErrorCodes.METHOD_NOT_FOUND, "host lifecycle not supported by this backend");
        }
        const { offset } = params as { offset: number };
        result = host.getLog
          ? await host.getLog(offset)
          : { lines: [], nextOffset: offset };
        break;
      }
    }

    validateResult(request.method as MethodName, result);
    return { result };
  } catch (error) {
    if (error instanceof RpcError) {
      return { error: { code: error.code, message: error.message } };
    }
    return {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
