// Calling the board server's JSON API, the same from a browser and from Paseo's daemon.

export interface Reply {
  ok: boolean;
  data: unknown;
}

/** One call, given up after five seconds, the reply's body included. */
export async function callBoard(url: string, token: string, method: string, body?: unknown): Promise<Reply> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-Vibeboard-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: response.ok, data: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

/** What the server sent, or its own message as the error. */
export function unwrap({ ok, data }: Reply, call: string): unknown {
  if (!ok) throw new Error((data as { error?: string }).error || call + " failed");
  return data;
}
