"use strict";

// Original Lucide 1.8.0 icon paths. See LUCIDE-LICENSE.txt (ISC / MIT).
const LUCIDE_ICONS = {
  "Folder": [
    [
      "path",
      {
        "d": "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
      }
    ]
  ],
  "Workflow": [
    [
      "rect",
      {
        "width": "8",
        "height": "8",
        "x": "3",
        "y": "3",
        "rx": "2"
      }
    ],
    [
      "path",
      {
        "d": "M7 11v4a2 2 0 0 0 2 2h4"
      }
    ],
    [
      "rect",
      {
        "width": "8",
        "height": "8",
        "x": "13",
        "y": "13",
        "rx": "2"
      }
    ]
  ],
  "List": [
    [
      "path",
      {
        "d": "M3 5h.01"
      }
    ],
    [
      "path",
      {
        "d": "M3 12h.01"
      }
    ],
    [
      "path",
      {
        "d": "M3 19h.01"
      }
    ],
    [
      "path",
      {
        "d": "M8 5h13"
      }
    ],
    [
      "path",
      {
        "d": "M8 12h13"
      }
    ],
    [
      "path",
      {
        "d": "M8 19h13"
      }
    ]
  ],
  "ChevronDown": [
    [
      "path",
      {
        "d": "m6 9 6 6 6-6"
      }
    ]
  ],
  "ChevronRight": [
    [
      "path",
      {
        "d": "m9 18 6-6-6-6"
      }
    ]
  ],
  "Check": [
    [
      "path",
      {
        "d": "M20 6 9 17l-5-5"
      }
    ]
  ],
  "Circle": [
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    ]
  ],
  "CircleDot": [
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    ],
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "1"
      }
    ]
  ],
  "Clock3": [
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    ],
    [
      "path",
      {
        "d": "M12 6v6h4"
      }
    ]
  ],
  "CircleDashed": [
    [
      "path",
      {
        "d": "M10.1 2.182a10 10 0 0 1 3.8 0"
      }
    ],
    [
      "path",
      {
        "d": "M13.9 21.818a10 10 0 0 1-3.8 0"
      }
    ],
    [
      "path",
      {
        "d": "M17.609 3.721a10 10 0 0 1 2.69 2.7"
      }
    ],
    [
      "path",
      {
        "d": "M2.182 13.9a10 10 0 0 1 0-3.8"
      }
    ],
    [
      "path",
      {
        "d": "M20.279 17.609a10 10 0 0 1-2.7 2.69"
      }
    ],
    [
      "path",
      {
        "d": "M21.818 10.1a10 10 0 0 1 0 3.8"
      }
    ],
    [
      "path",
      {
        "d": "M3.721 6.391a10 10 0 0 1 2.7-2.69"
      }
    ],
    [
      "path",
      {
        "d": "M6.391 20.279a10 10 0 0 1-2.69-2.7"
      }
    ]
  ],
  "Plus": [
    [
      "path",
      {
        "d": "M5 12h14"
      }
    ],
    [
      "path",
      {
        "d": "M12 5v14"
      }
    ]
  ],
  "ArrowUpRight": [
    [
      "path",
      {
        "d": "M7 7h10v10"
      }
    ],
    [
      "path",
      {
        "d": "M7 17 17 7"
      }
    ]
  ]
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of LUCIDE_ICONS[name]) {
    const part = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, value);
    svg.append(part);
  }
  return svg;
}
