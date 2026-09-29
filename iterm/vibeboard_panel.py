#!/usr/bin/env python3
"""iTerm2 AutoLaunch script: starts the panel server and registers the toolbelt tool.

Runs inside iTerm2's Python runtime. The server itself is a plain subprocess of
the same interpreter, so the panel keeps working if this script is restarted.
"""

import asyncio
import json
import os
import subprocess
import sys
import urllib.request

import iterm2

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))  # AutoLaunch holds a symlink
TOOL_ID = "com.github.kosmoche.vibeboard"  # iTerm2 keys its tool list by this; never change it


def post(url: str, token: str, path: str, data: dict) -> None:
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url + path,
        data=body,
        headers={"Content-Type": "application/json", "X-Vibeboard-Token": token},
    )
    try:
        urllib.request.urlopen(req, timeout=2).read()
    except OSError:
        pass  # the server is restarting; the next focus change will catch up


async def main(connection):
    # The API cookie in our environment is bound to this script's connection; `it2`
    # inside the server must not present it again, or iTerm2 refuses it.
    env = dict(os.environ, PYTHONPATH=ROOT)
    env.pop("ITERM2_COOKIE", None)
    env.pop("ITERM2_KEY", None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "vibeboard", "serve", "--json", "--exit-with-stdin"],
        stdin=subprocess.PIPE,  # closes when this script dies, and the server exits with it
        stdout=subprocess.PIPE,
        env=env,
        text=True,
    )
    info = json.loads(proc.stdout.readline())
    base = f"http://127.0.0.1:{info['port']}"
    print("vibeboard panel:", info["url"], file=sys.stderr, flush=True)
    # iTerm2 loads the URL once, when it creates the web view, and never retries: a page
    # that fails to load stays blank until the tool is closed and reopened. So do not
    # hand it the URL before the server answers.
    for _ in range(50):
        try:
            urllib.request.urlopen(f"{base}/api/version?token={info['token']}", timeout=1)
            break
        except OSError:
            await asyncio.sleep(0.1)
    await iterm2.tool.async_register_web_view_tool(
        connection, "Vibe Board", TOOL_ID, False, info["url"]
    )

    app = await iterm2.async_get_app(connection)

    async def focused_pane():
        """The session in the key window's current tab, after a fresh look at the hierarchy."""
        await app.async_refresh()
        window = app.current_terminal_window
        session = window and window.current_tab and window.current_tab.current_session
        return session.session_id if session else None

    pane = await focused_pane()
    post(base, info["token"], "/api/focus", {"pane": pane})

    # Any focus event may move the user to another pane: a new session in the same tab,
    # another tab, another window, or iTerm2 coming to the front.
    async with iterm2.FocusMonitor(connection) as monitor:
        while True:
            await monitor.async_get_next_update()
            now = await focused_pane()
            if now != pane:
                pane = now
                post(base, info["token"], "/api/focus", {"pane": pane})


iterm2.run_forever(main)
