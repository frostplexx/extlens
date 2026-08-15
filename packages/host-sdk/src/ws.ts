import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { ErrorCodes, RequestEnvelopeSchema } from "@extlens/protocol";
import { dispatch } from "./rpc.js";
import type { Backend } from "./backend.js";

/**
 * WebSocket wiring: upgrade, JSON-RPC envelope, error mapping. The SDK serves
 * the protocol from PROTOCOL.md over one WebSocket connection.
 */

export interface ExtlensServerOptions {
  port: number;
  backend: Backend;
  host?: string;
  /** Optional URL path, e.g. "/extlens". Defaults to any path. */
  path?: string;
}

export interface ExtlensServerHandle {
  /** The bound port (useful when port 0 was requested). */
  port: number;
  /** Gracefully stop the server and wait for connections to close. */
  close(): Promise<void>;
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function startServer(options: ExtlensServerOptions): ExtlensServerHandle {
  const wss = new WebSocketServer({
    port: options.port,
    host: options.host,
    path: options.path,
  });

  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      void handleMessage(options.backend, socket, data);
    });
  });

  const address = wss.address();
  const boundPort =
    address !== null && typeof address === "object" ? address.port : options.port;

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        // Under bun, wss.close() never completes while a client is connected.
        // Terminate clients first, wait for their sockets to close, then close
        // the server (which completes cleanly with zero clients). A hard
        // timeout guards against a stalled client socket.
        const clients = [...wss.clients];
        for (const client of clients) client.terminate();
        if (clients.length === 0) {
          wss.close(() => resolve());
          return;
        }
        let remaining = clients.length;
        const finish = () => wss.close(() => resolve());
        const timeout = setTimeout(finish, 2000);
        for (const client of clients) {
          client.once("close", () => {
            remaining -= 1;
            if (remaining === 0) {
              clearTimeout(timeout);
              finish();
            }
          });
        }
      }),
  };
}

async function handleMessage(
  backend: Backend,
  socket: WebSocket,
  data: RawData,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    sendJson(socket, {
      jsonrpc: "2.0",
      id: null,
      error: { code: ErrorCodes.PARSE_ERROR, message: "parse error" },
    });
    return;
  }

  const req = RequestEnvelopeSchema.safeParse(parsed);
  if (!req.success) {
    sendJson(socket, {
      jsonrpc: "2.0",
      id: null,
      error: { code: ErrorCodes.INVALID_REQUEST, message: "invalid request" },
    });
    return;
  }

  const { id, method, params } = req.data;
  const response = await dispatch(backend, { id, method, params });

  if ("error" in response) {
    sendJson(socket, { jsonrpc: "2.0", id, error: response.error });
  } else {
    sendJson(socket, { jsonrpc: "2.0", id, result: response.result });
  }
}
