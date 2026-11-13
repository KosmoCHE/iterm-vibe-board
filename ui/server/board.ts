import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import { callBoard } from "../shared/http";
import type { boardRpc } from "../shared/rpc";

// The board server that install.sh keeps running: vibeboard.server.DEFAULT_PORT, and the
// token it stores in its data directory.
const SERVER = "http://127.0.0.1:47431";
const HOME = process.env.VIBEBOARD_HOME || join(homedir(), ".iterm-vibe-board");

export async function request({ method, path, body }: RpcInput<typeof boardRpc>) {
  const token = (await readFile(join(HOME, "token"), "utf8")).trim();
  return callBoard(SERVER + path, token, method, body);
}
