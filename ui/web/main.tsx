// The board in a web view: iTerm2's Toolbelt, or any browser pointed at the server.

import { createRoot } from "react-dom/client";
import { Board } from "../client/board/Board";
import { DEFAULT_PREFS } from "../client/board/host";
import type { Host, Prefs } from "../client/board/host";
import { callBoard, unwrap } from "../shared/http";
import { Icon } from "./icons";

const TOKEN = new URLSearchParams(location.search).get("token") || "";
const PREFS = "vibeboard.prefs";
let assets: number | null = null; // version of the page's own files, as first reported

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const data = unwrap(await callBoard(path, TOKEN, method, body), `${method} ${path}`);
  if (path === "/api/version") {
    const now = (data as { assets: number }).assets;
    if (assets !== null && now !== assets) location.reload(); // the page's files changed
    assets = now;
  }
  return data;
}

const saved = localStorage.getItem(PREFS);
const host: Host = {
  request,
  // System colours, defined in index.html: they follow light and dark mode and the accent colour.
  colors: {
    foreground: "var(--fg)",
    foregroundMuted: "var(--muted)",
    surface0: "var(--bg)",
    surface2: "var(--control)",
    border: "var(--line)",
    accent: "var(--accent)",
    statusSuccess: "var(--done)",
    statusWarning: "var(--warn)",
    statusDanger: "var(--danger)",
  },
  Icon,
  prefs: { ...DEFAULT_PREFS, ...(saved ? (JSON.parse(saved) as Partial<Prefs>) : {}) }, // an older build saved other fields
  savePrefs: (prefs) => localStorage.setItem(PREFS, JSON.stringify(prefs)),
  copyText: (text) => navigator.clipboard.writeText(text),
  jump: async (pane) => {
    await request("POST", "/api/jump", { pane: pane.pane });
  },
  shortcuts(commands) {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement ? document.activeElement.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        commands.undo();
      }
      if (e.key === "Escape") commands.escape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  },
};

createRoot(document.getElementById("root")!).render(<Board host={host} />);
