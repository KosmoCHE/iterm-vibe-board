import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BoardPanel } from "./client/paseo";

export default function contribute(client: PluginClientContext) {
  // A workspace panel: those are what Explorer's + menu offers.
  return client.addWorkspacePanel({
    id: "board",
    title: "Vibe Board",
    icon: "ListTodo",
    locations: ["explorer", "workspace"],
    Component: BoardPanel,
  });
}
