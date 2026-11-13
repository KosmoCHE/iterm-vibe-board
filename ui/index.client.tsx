import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BoardPanel } from "./client/paseo";

export default function contribute(client: PluginClientContext) {
  return client.addAgentPanel({
    id: "board",
    title: "Vibe Board",
    icon: "ListTodo",
    locations: ["explorer", "workspace"],
    Component: BoardPanel,
  });
}
