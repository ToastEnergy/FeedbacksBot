import { config } from "./config";

/** A direct message as returned by the SGC bot API. */
export interface Message {
  id: number;
  sender: string;
  recipient: string;
  content: string;
  images: string[];
  created_at: string;
}

export interface BotProfile {
  id: number;
  username: string;
  name: string;
  muted: boolean;
  mute_reason: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.sgcUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.sgcToken}`,
        // The server refuses writes without a Content-Type, even with no body.
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get("Retry-After")) || 5;
      console.warn(`[sgc] rate limited, retrying in ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[sgc] ${method} ${path} -> ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

export const sgc = {
  me: () => request<BotProfile>("GET", "/api/bot/me"),

  /** Messages the bot received, oldest first. Without `after`: the most recent ones. */
  received: (after?: number, limit = 100) =>
    request<Message[]>(
      "GET",
      `/api/bot/messages?limit=${limit}${after ? `&after=${after}` : ""}`,
    ),

  send: (username: string, content: string, replyTo?: number) =>
    request<Message>("POST", `/api/bot/messages/${encodeURIComponent(username)}`, {
      content,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),

  markRead: (username: string) =>
    request<unknown>("POST", `/api/bot/messages/${encodeURIComponent(username)}/read`),
};

export interface StreamHandlers {
  onReady: () => void | Promise<void>;
  onMessage: (msg: Message) => void | Promise<void>;
}

/**
 * Keeps GET /api/bot/stream (server-sent events) open forever, reconnecting with backoff.
 * `onReady` fires on every (re)connect so the caller can catch up on missed messages.
 */
export async function runStream(handlers: StreamHandlers): Promise<never> {
  let backoff = 1000;
  for (;;) {
    try {
      const res = await fetch(`${config.sgcUrl}/api/bot/stream`, {
        headers: { Authorization: `Bearer ${config.sgcToken}`, Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) throw new Error(`stream -> ${res.status}: ${await res.text()}`);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let event = "message";
      let data: string[] = [];

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);

          if (line === "") {
            // Blank line: dispatch the event.
            if (data.length) {
              const payload = data.join("\n");
              if (event === "ready") {
                backoff = 1000;
                console.log(`[sgc] stream connected: ${payload}`);
                await handlers.onReady();
              } else if (event === "message") {
                await handlers.onMessage(JSON.parse(payload) as Message);
              }
            }
            event = "message";
            data = [];
          } else if (line.startsWith(":")) {
            // keep-alive
          } else if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data.push(line.slice(5).replace(/^ /, ""));
          }
        }
      }
      console.warn("[sgc] stream closed by server");
    } catch (err) {
      console.error("[sgc] stream error:", err instanceof Error ? err.message : err);
    }
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 60_000);
  }
}
