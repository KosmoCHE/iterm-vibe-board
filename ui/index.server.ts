import type { PluginServerContext } from "@getpaseo/plugin/server";
import { request } from "./server/board";
import { boardRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(boardRpc, request);
  return () => {};
}
