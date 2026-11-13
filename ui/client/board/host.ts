// What the board needs from the place it runs in. The board itself imports only
// react and react-native; iTerm2's web view (web/) and Paseo (client/paseo.tsx)
// each supply one Host.

import type { ComponentType } from "react";

export type Status = "todo" | "doing" | "waiting" | "later" | "done";
export type Tab = "global" | "project" | "session";

export interface Item {
  id: string;
  title: string;
  description: string;
  status: Status;
  origin: string;
  created_by: string;
  driver: string | null;
  project: string;
  parent: string | null;
  depends_on: string[];
  next: string;
  waiting_for: string;
  due: string | null;
  created_at: string;
  started_at: string | null;
  done_at: string | null;
}

/** Where a session runs: an iTerm2 pane or a Paseo agent. */
export interface Pane {
  pane: string;
  host?: string; // "paseo" for a Paseo agent, absent for an iTerm2 pane
  session?: string;
  project?: string;
  started_at?: string;
  ended_at?: string | null;
  name: string;
  alive: boolean;
}

/** GET /api/board */
export interface BoardData {
  version: string;
  focus: { pane: string | null };
  projects: Record<string, { name: string; path: string }>;
  panes: Record<string, Pane>;
  items: Item[];
  statuses: Status[];
  origins: string[];
  labels: Record<Status, string>;
  me: string;
}

export interface Colors {
  foreground: string;
  foregroundMuted: string;
  surface0: string; // the panel
  surface1: string; // cards
  surface2: string; // controls and badges
  border: string;
  accent: string;
  statusSuccess: string;
  statusWarning: string;
  statusDanger: string;
}

export type IconName =
  | "ArrowUpRight"
  | "Check"
  | "ChevronDown"
  | "ChevronRight"
  | "Circle"
  | "CircleDashed"
  | "CircleDot"
  | "Clock3"
  | "Plus"
  | "X";

/** What the board remembers between visits. A type, not an interface: hosts store it as JSON. */
export type Prefs = {
  tab: Tab;
  open: Record<string, boolean>; // "scope:task": false once that task's steps are folded
};

export const DEFAULT_PREFS: Prefs = { tab: "global", open: {} };

export interface Commands {
  undo(): void;
  escape(): void;
}

export interface Host {
  /** Call the board server's JSON API. Rejects with the server's message. */
  request(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<unknown>;
  colors: Colors;
  Icon: ComponentType<{ name: IconName; size: number; color: string }>;
  /** Read once, when the board mounts. */
  prefs: Prefs;
  savePrefs(prefs: Prefs): void;
  copyText(text: string): Promise<void>;
  /**
   * Is this a pane the board sits beside? Project and Session show what runs in those.
   * Absent: the one pane the server reports as focused.
   */
  beside?(pane: Pane): boolean;
  /** The directory the board itself sits in, when the host has one: Project shows it before any session runs there. */
  project?: string;
  /** Bring the user to a live pane. */
  jump(pane: Pane): Promise<void>;
  /** Bind the host's keyboard shortcuts to the board's commands; returns the unbind. */
  shortcuts?(commands: Commands): () => void;
}
