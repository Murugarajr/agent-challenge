import { Buffer } from "node:buffer";

import { logger, type IAgentRuntime } from "@elizaos/core";

import type { AppliedFilePatch } from "./client";

type RepoRef = {
  owner: string;
  repo: string;
};

export type GitHubPrResult = {
  prUrl: string;
  prNumber: number;
  headBranch: string;
  baseBranch: string;
  targetRepo: string;
};

function getSetting(runtime: IAgentRuntime, key: string): string | undefined {
  const value = runtime.getSetting(key);
  if (value !== undefined && value !== null) {
    const normalized = String(value).trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const envValue = process.env[key]?.trim();
  return envValue && envValue.length > 0 ? envValue : undefined;
}

function getGitHubToken(runtime: IAgentRuntime): string | undefined {
  return (
    getSetting(runtime, "MISOKI_GITHUB_TOKEN") ??
    getSetting(runtime, "GITHUB_TOKEN") ??
    getSetting(runtime, "GH_TOKEN")
  );
}

function getGitHubApiBase(runtime: IAgentRuntime): string {
  return (getSetting(runtime, "MISOKI_GITHUB_API_BASE") ?? "https://api.github.com").replace(/\/$/, "");
}

function getGitHubTimeoutMs(runtime: IAgentRuntime): number {
  const rawValue = getSetting(runtime, "MISOKI_GITHUB_TIMEOUT_MS");
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 30_000;
}

function parseRepoUrl(githubUrl: string): RepoRef {
  const match = githubUrl.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match) {
    throw new Error("GitHub URL is invalid.");
  }
  return {
    owner: match[1],
    repo: match[2],
  };
}

function parseRepoRef(input: string): RepoRef {
  const normalized = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/$/, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("MISOKI_GITHUB_TARGET_REPO must be in owner/repo format.");
  }
  return {
    owner: parts[0],
    repo: parts[1],
  };
}

function sanitizeBranchName(branchName: string): string {
  return branchName
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, 120);
}

async function githubRequest<T>(
  runtime: IAgentRuntime,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getGitHubToken(runtime);
  if (!token) {
    throw new Error("GitHub token is not configured. Set MISOKI_GITHUB_TOKEN or GITHUB_TOKEN.");
  }

  const apiBase = getGitHubApiBase(runtime);
  const timeoutMs = getGitHubTimeoutMs(runtime);
  const url = `${apiBase}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "misoki-eliza-agent",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as T | { message?: string }) : ({} as T);
    if (!response.ok) {
      const message =
        typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string"
          ? parsed.message
          : text || `GitHub API returned ${response.status}`;
      throw new Error(`GitHub API error ${response.status}: ${message}`);
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GitHub API timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getDefaultBranch(runtime: IAgentRuntime, repo: RepoRef): Promise<string> {
  const metadata = await githubRequest<{ default_branch: string }>(runtime, "GET", `/repos/${repo.owner}/${repo.repo}`);
  return metadata.default_branch;
}

async function getBranchSha(runtime: IAgentRuntime, repo: RepoRef, branch: string): Promise<string> {
  const encodedBranch = encodeURIComponent(branch);
  const ref = await githubRequest<{ object: { sha: string } }>(
    runtime,
    "GET",
    `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodedBranch}`
  );
  return ref.object.sha;
}

async function createBranch(runtime: IAgentRuntime, repo: RepoRef, branchName: string, sha: string): Promise<void> {
  await githubRequest(
    runtime,
    "POST",
    `/repos/${repo.owner}/${repo.repo}/git/refs`,
    {
      ref: `refs/heads/${branchName}`,
      sha,
    }
  );
}

async function getFileSha(runtime: IAgentRuntime, repo: RepoRef, branch: string, filePath: string): Promise<string> {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const payload = await githubRequest<{ sha: string }>(
    runtime,
    "GET",
    `/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
  );
  return payload.sha;
}

async function updateFile(
  runtime: IAgentRuntime,
  repo: RepoRef,
  branch: string,
  file: AppliedFilePatch,
  message: string
): Promise<void> {
  const encodedPath = file.file.split("/").map(encodeURIComponent).join("/");
  const sha = await getFileSha(runtime, repo, branch, file.file);
  await githubRequest(
    runtime,
    "PUT",
    `/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}`,
    {
      message,
      content: Buffer.from(file.modified, "utf-8").toString("base64"),
      branch,
      sha,
    }
  );
}

async function createPullRequest(
  runtime: IAgentRuntime,
  sourceRepo: RepoRef,
  targetRepo: RepoRef,
  baseBranch: string,
  headBranch: string,
  title: string,
  body: string
): Promise<GitHubPrResult> {
  const head = sourceRepo.owner === targetRepo.owner && sourceRepo.repo === targetRepo.repo
    ? headBranch
    : `${targetRepo.owner}:${headBranch}`;

  const pr = await githubRequest<{ html_url: string; number: number }>(
    runtime,
    "POST",
    `/repos/${sourceRepo.owner}/${sourceRepo.repo}/pulls`,
    {
      title,
      body,
      base: baseBranch,
      head,
      draft: true,
    }
  );

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
    headBranch,
    baseBranch,
    targetRepo: `${targetRepo.owner}/${targetRepo.repo}`,
  };
}

export async function createGitHubPrFromPatches(
  runtime: IAgentRuntime,
  input: {
    analyzedRepoUrl: string;
    baseBranch?: string;
    branchName: string;
    title: string;
    body: string;
    files: AppliedFilePatch[];
  }
): Promise<GitHubPrResult> {
  if (input.files.length === 0) {
    throw new Error("No changed files are available to create a pull request.");
  }

  const sourceRepo = parseRepoUrl(input.analyzedRepoUrl);
  const targetRepoSetting = getSetting(runtime, "MISOKI_GITHUB_TARGET_REPO");
  const targetRepo = targetRepoSetting ? parseRepoRef(targetRepoSetting) : sourceRepo;
  const baseBranch = input.baseBranch || (await getDefaultBranch(runtime, sourceRepo));
  const targetBaseBranch = input.baseBranch || (await getDefaultBranch(runtime, targetRepo));
  const baseSha = await getBranchSha(runtime, targetRepo, targetBaseBranch);
  const branchName = sanitizeBranchName(input.branchName);

  logger.info(
    {
      analyzedRepo: `${sourceRepo.owner}/${sourceRepo.repo}`,
      targetRepo: `${targetRepo.owner}/${targetRepo.repo}`,
      baseBranch,
      targetBaseBranch,
      branchName,
      fileCount: input.files.length,
    },
    "Creating GitHub PR from Misoki patch set"
  );

  await createBranch(runtime, targetRepo, branchName, baseSha);

  for (const file of input.files) {
    await updateFile(
      runtime,
      targetRepo,
      branchName,
      file,
      `Apply Misoki safe fixes to ${file.file}`
    );
  }

  return createPullRequest(runtime, sourceRepo, targetRepo, baseBranch, branchName, input.title, input.body);
}
