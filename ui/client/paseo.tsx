// The board as a Paseo panel, beside the agents of one workspace.

import { type PluginWorkspacePanelProps, usePaseo, useRpc, useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";
import { unwrap } from "../shared/http";
import { boardRpc } from "../shared/rpc";
import { Board } from "./board/Board";
import { DEFAULT_PREFS } from "./board/host";
import type { Host, Pane, Prefs } from "./board/host";

const prefs = z.object({
  tab: z.enum(["global", "project", "session"]),
  open: z.record(z.string(), z.boolean()),
});

const PaseoIcon: Host["Icon"] = (props) => <Icon {...props} />;

/** The agents of a workspace, named as the board's store names panes: it upper-cases their ids. */
async function agentsIn(paseo: ReturnType<typeof usePaseo>, workspaceId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const { entries, pageInfo } = await paseo.agents.list({ page: { limit: 200, cursor } });
    for (const { agent } of entries) if (agent.workspaceId === workspaceId) ids.push(agent.id.toUpperCase());
    cursor = pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}

export function BoardPanel({ theme, navigation, workspaceId, tab }: PluginWorkspacePanelProps) {
  const call = useRpc(boardRpc);
  const paseo = usePaseo();
  const [saved, save] = useTabState<Prefs>(tab, prefs, DEFAULT_PREFS);
  // Only Paseo knows which agents a workspace holds, and they come and go.
  const agents = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => agentsIn(paseo, workspaceId),
    refetchInterval: 5000,
    throwOnError: true,
  });
  const beside = useCallback((pane: Pane) => Boolean(agents.data?.includes(pane.pane)), [agents.data]);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);

  const request: Host["request"] = async (method, path, body) => unwrap(await call({ method, path, body }), `${method} ${path}`);
  const host: Host = {
    request,
    colors: theme.colors,
    Icon: PaseoIcon,
    prefs: saved,
    savePrefs: save,
    copyText,
    beside,
    project: directory ?? undefined, // null while Paseo has no record of the workspace
    async jump(pane) {
      if (pane.host !== "paseo") await request("POST", "/api/jump", { pane: pane.pane }); // an iTerm2 pane
      else if (navigation) navigation.openAgent({ agentId: pane.pane.toLowerCase() });
      else throw new Error("This Paseo client cannot open an agent from a panel");
    },
  };
  return <Board host={host} />;
}
