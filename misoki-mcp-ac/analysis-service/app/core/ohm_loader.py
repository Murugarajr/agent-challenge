from __future__ import annotations

import sys
from pathlib import Path


def ensure_ohm_mcp_on_path(configured_path: str | None = None) -> Path:
    candidates: list[Path] = []

    if configured_path:
        candidates.append(Path(configured_path).expanduser().resolve())

    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "ohm-mcp" / "src"
        candidates.append(candidate)

    for candidate in candidates:
        package_dir = candidate / "ohm_mcp"
        if package_dir.exists():
            path_str = str(candidate)
            if path_str not in sys.path:
                sys.path.insert(0, path_str)
            return candidate

    raise RuntimeError(
        "Could not locate ohm-mcp source directory. Set OHM_MCP_SRC_PATH or place this "
        "service in the same workspace as the ohm-mcp project."
    )

