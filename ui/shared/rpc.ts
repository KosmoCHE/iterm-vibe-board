import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** One call to the board server's JSON API, made by the daemon for a client that may be remote. */
export const boardRpc = defineRpc({
  name: "board.request",
  input: z.object({
    method: z.enum(["GET", "POST", "PATCH"]),
    path: z.string().startsWith("/api/"),
    body: z.unknown().optional(),
  }),
  output: z.object({ ok: z.boolean(), data: z.unknown() }),
});
