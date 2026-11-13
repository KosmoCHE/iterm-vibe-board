// Lucide 1.8.0 icon paths (ISC / MIT, see LUCIDE-LICENSE.txt), drawn as inline SVG.
// Only the web host draws its own icons; Paseo supplies Lucide itself.

import { createElement } from "react";
import type { IconName } from "../client/board/host";

const PATHS: Record<IconName, [string, Record<string, string>][]> = {
  ArrowUpRight: [["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],
  Check: [["path",{"d":"M20 6 9 17l-5-5"}]],
  ChevronDown: [["path",{"d":"m6 9 6 6 6-6"}]],
  ChevronRight: [["path",{"d":"m9 18 6-6-6-6"}]],
  Circle: [["circle",{"cx":"12","cy":"12","r":"10"}]],
  CircleDashed: [["path",{"d":"M10.1 2.182a10 10 0 0 1 3.8 0"}],["path",{"d":"M13.9 21.818a10 10 0 0 1-3.8 0"}],["path",{"d":"M17.609 3.721a10 10 0 0 1 2.69 2.7"}],["path",{"d":"M2.182 13.9a10 10 0 0 1 0-3.8"}],["path",{"d":"M20.279 17.609a10 10 0 0 1-2.7 2.69"}],["path",{"d":"M21.818 10.1a10 10 0 0 1 0 3.8"}],["path",{"d":"M3.721 6.391a10 10 0 0 1 2.7-2.69"}],["path",{"d":"M6.391 20.279a10 10 0 0 1-2.69-2.7"}]],
  CircleDot: [["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"1"}]],
  Clock3: [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],
  Plus: [["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],
  X: [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],
};

export function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  return createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: color,
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      style: { flex: "none" },
    },
    PATHS[name].map(([tag, attrs], n) => createElement(tag, { key: n, ...attrs })),
  );
}
