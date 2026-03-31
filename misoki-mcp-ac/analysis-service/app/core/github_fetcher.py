from __future__ import annotations

import asyncio
import base64
import json
import re
import ssl
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.path_priority import python_file_priority


GITHUB_REPO_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$"
)


@dataclass(frozen=True)
class RepoFile:
    path: str
    content: str
    size: int


@dataclass(frozen=True)
class RepoSnapshot:
    github_url: str
    owner: str
    repo: str
    branch: str
    commit_sha: str
    files: list[RepoFile]


@dataclass(frozen=True)
class ParsedRepo:
    owner: str
    repo: str


class GitHubRepoFetcher:
    def __init__(
        self,
        api_base: str,
        timeout_seconds: float,
        max_file_bytes: int,
        verify_ssl: bool = True,
        max_concurrent_file_fetches: int = 5,
        github_token: str | None = None,
    ):
        self.api_base = api_base.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_file_bytes = max_file_bytes
        self.verify_ssl = verify_ssl
        self.max_concurrent_file_fetches = max(1, max_concurrent_file_fetches)
        self.github_token = github_token

    def parse_repo_url(self, github_url: str) -> ParsedRepo:
        match = GITHUB_REPO_RE.match(github_url.strip())
        if not match:
            raise ValueError("github_url must be a public GitHub repository URL")

        return ParsedRepo(owner=match.group("owner"), repo=match.group("repo"))

    async def fetch_repo_snapshot(
        self,
        github_url: str,
        branch: str | None,
        max_files: int,
    ) -> RepoSnapshot:
        parsed = self.parse_repo_url(github_url)

        repo_meta = await self._get_json(f"/repos/{parsed.owner}/{parsed.repo}")
        selected_branch = branch or repo_meta["default_branch"]
        branch_ref = quote(selected_branch, safe="")

        branch_meta = await self._get_json(
            f"/repos/{parsed.owner}/{parsed.repo}/branches/{branch_ref}",
        )
        commit_sha = branch_meta["commit"]["sha"]

        tree = await self._get_json(
            f"/repos/{parsed.owner}/{parsed.repo}/git/trees/{branch_ref}?recursive=1",
        )
        blob_entries = [item for item in tree.get("tree", []) if item.get("type") == "blob"]

        selected_entries = self._select_blob_entries(blob_entries, max_files=max_files)
        files = await self._fetch_file_contents(
            owner=parsed.owner,
            repo=parsed.repo,
            branch=selected_branch,
            entries=selected_entries,
        )

        return RepoSnapshot(
            github_url=github_url,
            owner=parsed.owner,
            repo=parsed.repo,
            branch=selected_branch,
            commit_sha=commit_sha,
            files=files,
        )

    def _select_blob_entries(self, blob_entries: list[dict[str, Any]], max_files: int) -> list[dict[str, Any]]:
        python_entries = [
            entry
            for entry in blob_entries
            if entry.get("path", "").endswith(".py")
            and int(entry.get("size", 0) or 0) <= self.max_file_bytes
        ]
        python_entries.sort(key=lambda entry: python_file_priority(entry["path"]))
        return python_entries[:max_files]

    async def _fetch_file_contents(
        self,
        owner: str,
        repo: str,
        branch: str,
        entries: list[dict[str, Any]],
    ) -> list[RepoFile]:
        semaphore = asyncio.Semaphore(self.max_concurrent_file_fetches)

        async def fetch_one(entry: dict[str, Any]) -> RepoFile:
            async with semaphore:
                content = await self._get_file_content(
                    owner=owner,
                    repo=repo,
                    path=entry["path"],
                    branch=branch,
                )
                return RepoFile(
                    path=entry["path"],
                    content=content,
                    size=entry.get("size", len(content)),
                )

        return await asyncio.gather(*(fetch_one(entry) for entry in entries))

    async def _get_json(self, path: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._get_json_sync, path)

    def _get_json_sync(self, path: str) -> dict[str, Any]:
        url = f"{self.api_base}{path}"
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "misoki-analysis-service",
        }
        if self.github_token:
            headers["Authorization"] = f"Bearer {self.github_token}"
            
        request = Request(url, headers=headers)
        try:
            if self.verify_ssl:
                try:
                    import certifi
                    context = ssl.create_default_context(cafile=certifi.where())
                except ImportError:
                    context = ssl.create_default_context()
            else:
                context = ssl._create_unverified_context()
            with urlopen(request, timeout=self.timeout_seconds, context=context) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"GitHub API request failed: {exc.code} {body}") from exc
        except URLError as exc:
            raise RuntimeError(f"GitHub API request failed: {exc.reason}") from exc

    async def _get_file_content(
        self,
        owner: str,
        repo: str,
        path: str,
        branch: str,
    ) -> str:
        encoded_path = quote(path, safe="/")
        encoded_branch = quote(branch, safe="")
        payload = await self._get_json(f"/repos/{owner}/{repo}/contents/{encoded_path}?ref={encoded_branch}")
        content = payload.get("content", "")
        encoding = payload.get("encoding", "utf-8")

        if encoding == "base64":
            return base64.b64decode(content).decode("utf-8", errors="replace")
        return content

    async def fetch_file(
        self,
        github_url: str,
        file_path: str,
        branch: str | None = None,
    ) -> RepoFile:
        parsed = self.parse_repo_url(github_url)
        selected_branch = branch
        if not selected_branch:
            repo_meta = await self._get_json(f"/repos/{parsed.owner}/{parsed.repo}")
            selected_branch = repo_meta["default_branch"]

        content = await self._get_file_content(
            owner=parsed.owner,
            repo=parsed.repo,
            path=file_path,
            branch=selected_branch,
        )
        return RepoFile(path=file_path, content=content, size=len(content))
