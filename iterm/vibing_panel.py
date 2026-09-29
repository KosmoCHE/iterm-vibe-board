#!/usr/bin/env python3
"""iTerm2 AutoLaunch script: starts the panel server and registers the toolbelt tool.

Runs inside iTerm2's Python runtime. The server itself is a plain subprocess of
the same interpreter, so the panel keeps working if this script is restarted.
"""

import json
import os
import subprocess
import sys
import urllib.request

import iterm2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL_ID = "com.github.kosmoche.vibing"


def post(url: str, token: str, path: str, data: dict) -> None:
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url + path, data=body, headers={"Content-Type": "application/json", "X-Vibing-Token": token}
    )
    try:
        urllib.request.urlopen(req, timeout=2).read()
    except OSError:
        pass  # the server is restarting; the next focus change will catch up


async def main(connection):
    env = dict(os.environ, PYTHONPATH=ROOT)
    proc = subprocess.Popen(
        [sys.executable, "-m", "vibing", "serve", "--json"],
        stdout=subprocess.PIPE,
        env=env,
        text=True,
    )
    info = json.loads(proc.stdout.readline())
    base = f"http://127.0.0.1:{info['port']}"
    print("vibing panel:", info["url"], file=sys.stderr, flush=True)
    await iterm2.tool.async_register_web_view_tool(
        connection, "Vibing", TOOL_ID, False, info["url"]
    )

    app = await iterm2.async_get_app(connection)
    session = (
        app.current_terminal_window and app.current_terminal_window.current_tab.current_session
    )
    if session:
        post(base, info["token"], "/api/focus", {"pane": session.session_id})

    async with iterm2.FocusMonitor(connection) as monitor:
        while True:
            update = await monitor.async_get_next_update()
            changed = update.active_session_changed
            if changed:
                post(base, info["token"], "/api/focus", {"pane": changed.session_id})


iterm2.run_forever(main)
