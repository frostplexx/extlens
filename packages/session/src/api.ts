import type { ConnectionStatus } from "./types.js";

/**
 * How long a call may go unanswered before it is treated as lost.
 *
 * Long enough that no working call trips it: explaining a failure runs a model, and an export pulls
 * every transcript in the corpus. Short enough that a wedged host surfaces as an error the user can
 * read rather than a control that spins forever.
 */
const CALL_TIMEOUT_MS = 120_000;

/**
 * Protocol client over WebSocket. Owns the connection lifecycle including
 * reconnect with exponential backoff. Requests are id-mapped; responses are
 * routed to their pending promise.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class ExtlensClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private onStatus: (status: ConnectionStatus, message?: string) => void,
  ) {}

  start(): void {
    this.stopped = false;
    void this.connectOnce();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.failAllPending(new Error("client stopped"));
    this.ws?.close();
    this.ws = null;
  }

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      /*
       * Every call gets a deadline.
       *
       * A dropped connection already fails its in-flight calls (handleDisconnect), but a host that
       * stays connected and simply never answers left the caller waiting forever, and the client has
       * no way to tell that from slow. It showed up as a dialog stuck on its spinner with nothing to
       * click and nothing logged.
       *
       * Generous on purpose: explaining a failure runs a model and collecting a corpus of transcripts
       * moves megabytes, so this is a stuck-detector and not a latency budget.
       */
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(CALL_TIMEOUT_MS / 1000)}s`));
      }, CALL_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: ((value: unknown) => {
          clearTimeout(timer);
          (resolve as (value: unknown) => void)(value);
        }) as (value: unknown) => void,
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        }),
      );
    });
  }

  private async connectOnce(): Promise<void> {
    this.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (event) => this.handleMessage(String(event.data));

    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("socket error"));
        ws.onclose = () => reject(new Error("connection closed"));
      });
    } catch (error) {
      // Connection refused or dropped before open. Retry with backoff.
      this.ws = null;
      if (this.stopped) return;
      const message = error instanceof Error ? error.message : String(error);
      this.onStatus("disconnected", message);
      this.failAllPending(new Error("connection lost"));
      this.scheduleRetry();
      return;
    }

    if (this.stopped) return;
    this.attempt = 0;
    this.onStatus("connected");
    ws.onclose = () => this.handleDisconnect();
    ws.onerror = () => {
      /* close follows error */
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delay = Math.min(1000 * 2 ** this.attempt, 8000);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => void this.connectOnce(), delay);
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.onStatus("disconnected", "connection lost");
    this.failAllPending(new Error("connection lost"));
    this.scheduleRetry();
  }

  private handleMessage(raw: string): void {
    let msg: { id?: unknown; result?: unknown; error?: { code: number; message: string } };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id !== "number" && typeof msg.id !== "string") return;
    const pending = this.pending.get(msg.id as number | string);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private failAllPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
