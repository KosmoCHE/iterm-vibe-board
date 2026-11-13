// Bundles the web host into ui/dist, which vibeboard/server.py serves.
// The bundle is committed, so installing the board needs no Node.

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(fileURLToPath(import.meta.url));
const dist = join(web, "..", "dist");

await mkdir(dist, { recursive: true });
await build({
  entryPoints: [join(web, "main.tsx")],
  outfile: join(dist, "board.js"),
  bundle: true,
  minify: true,
  target: "safari16",
  jsx: "automatic",
  alias: { "react-native": "react-native-web" },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});
await copyFile(join(web, "index.html"), join(dist, "index.html"));
await copyFile(join(web, "LUCIDE-LICENSE.txt"), join(dist, "LUCIDE-LICENSE.txt"));
