"""Check installer directory selection without modifying the user's installation."""

import shlex
import subprocess
from pathlib import Path

import pytest

INSTALL = Path(__file__).resolve().parents[1] / "install.sh"
SETUP = INSTALL.read_text().split('case "${1:-}" in')[0]


def shell(command):
    return subprocess.run(
        ["sh", "-c", SETUP + "\n" + command], check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.mark.parametrize(
    "layout",
    [".config/iterm2/AppSupport", ".iterm2/AppSupport", "Library/Application Support/iTerm2"],
)
def test_selects_active_support_directory(tmp_path, layout):
    (tmp_path / "Library/Application Support/iTerm2").mkdir(parents=True)
    support = tmp_path / layout
    support.mkdir(parents=True, exist_ok=True)
    assert shell("iterm_support " + shlex.quote(str(tmp_path))) == str(support)


@pytest.mark.parametrize("alias", [False, True])
def test_removes_only_separate_legacy_link(tmp_path, alias):
    legacy = tmp_path / "legacy"
    modern = tmp_path / "modern"
    relative = Path("Scripts/AutoLaunch/vibeboard_panel.py")
    old = legacy / relative
    old.parent.mkdir(parents=True)
    target = tmp_path / "repo/iterm/vibeboard_panel.py"
    target.parent.mkdir(parents=True)
    target.touch()
    old.symlink_to(target)
    if alias:
        modern.symlink_to(legacy, target_is_directory=True)
    else:
        (modern / relative).parent.mkdir(parents=True)
        (modern / relative).symlink_to(target)
    assignments = {"ROOT": target.parents[1], "LEGACY_SUPPORT": legacy, "SUPPORT": modern}
    shell(
        "\n".join(f"{key}={shlex.quote(str(value))}" for key, value in assignments.items())
        + "\nremove_legacy_panel"
    )
    assert old.is_symlink() == alias
    assert (modern / relative).resolve() == target
    assert target.is_file()
