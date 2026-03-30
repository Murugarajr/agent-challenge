from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    github_api_base: str
    request_timeout_seconds: float
    max_file_bytes: int
    max_repo_files: int
    max_concurrent_file_fetches: int
    ohm_mcp_src_path: str | None
    verify_ssl: bool
    github_token: str | None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            github_api_base=os.getenv("MISOKI_GITHUB_API_BASE", "https://api.github.com"),
            request_timeout_seconds=float(os.getenv("MISOKI_REQUEST_TIMEOUT_SECONDS", "20")),
            max_file_bytes=int(os.getenv("MISOKI_MAX_FILE_BYTES", "200000")),
            max_repo_files=int(os.getenv("MISOKI_MAX_REPO_FILES", "40")),
            max_concurrent_file_fetches=int(os.getenv("MISOKI_MAX_CONCURRENT_FILE_FETCHES", "5")),
            ohm_mcp_src_path=os.getenv("OHM_MCP_SRC_PATH"),
            verify_ssl=os.getenv("MISOKI_VERIFY_SSL", "true").lower() not in {"0", "false", "no"},
            github_token=os.getenv("GITHUB_TOKEN") or os.getenv("MISOKI_GITHUB_TOKEN"),
        )

    @property
    def service_root(self) -> Path:
        return Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
