// The board as a Paseo panel, beside one agent.

import { type PluginAgentPanelProps, useRpc, useTabState } from "@getpaseo/plugin/client";
import { copyText, Icon } from "@getpaseo/plugin/client/ui";
import { z } from "zod";
import { boardRpc } from "../shared/rpc";
import { Board } from "./board/Board";
import { DEFAULT_PREFS } from "./board/host";
import type { Host, Prefs } from "./board/host";

const prefs = z.object({
  tab: z.enum(["global", "project", "session"]),
  view: z.enum(["list", "graph"]),
  fold: z.record(z.string(), z.boolean()),
  graphOpen: z.record(z.string(), z.boolean()),
});

const PaseoIcon: Host["Icon"] = (props) => <Icon {...props} />;

export function BoardPanel({ theme, navigation, params, tab }: PluginAgentPanelProps) {
  const call = useRpc(boardRpc);
  const [saved, save] = useTabState<Prefs>(tab, prefs, DEFAULT_PREFS);

  const request: Host["request"] = async (method, path, body) => {
    const { ok, data } = await call({ method, path, body });
    if (!ok) throw new Error((data as { error?: string }).error || `${method} ${path} failed`);
    return data;
  };
  const host: Host = {
    request,
    colors: theme.colors,
    Icon: PaseoIcon,
    prefs: saved,
    savePrefs: save,
    copyText,
    // The board's store upper-cases pane ids; Paseo's agent ids are lower-case UUIDs.
    pane: params.agentId.toUpperCase(),
    async jump(pane) {
      if (pane.host !== "paseo") await request("POST", "/api/jump", { pane: pane.pane }); // an iTerm2 pane
      else if (navigation) navigation.openAgent({ agentId: pane.pane.toLowerCase() });
      else throw new Error("This Paseo client cannot open an agent from a panel");
    },
  };
  return <Board host={host} />;
}
