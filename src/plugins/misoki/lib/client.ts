import { logger, type IAgentRuntime } from "@elizaos/core";

type SeveritySummary = {
  critical: number;
  warning: number;
  info: number;
};

export type AnalysisIssue = {
  file: string;
  category: string;
  severity: string;
  title: string;
  details: string;
  line?: number | null;
  fixable: boolean;
  fix_id: string;
  source_type: string;
};

export type AnalyzeRepoResponse = {
  repo: string;
  branch: string;
  commit: string;
  files_scanned: number;
  skipped_files: number;
  categories: Record<string, number>;
  summary: SeveritySummary;
  issues: AnalysisIssue[];
};

export type PreviewFixResponse = {
  file: string;
  line?: number | null;
  source_type: string;
  risk: string;
  supported: boolean;
  message: string;
  original: string;
  modified: string;
  diff: string;
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

function getAnalysisServiceBaseUrl(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, "MISOKI_ANALYSIS_SERVICE_URL") ??
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

function getAnalysisMaxFiles(runtime: IAgentRuntime): number {
  const rawValue = getSetting(runtime, "MISOKI_ANALYSIS_MAX_FILES");
  if (!rawValue) {
    return 3;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 3;
  }

  return parsed;
}

function getAnalysisTimeoutMs(runtime: IAgentRuntime): number {
  const rawValue = getSetting(runtime, "MISOKI_ANALYSIS_TIMEOUT_MS");
  if (!rawValue) {
    return 30_000;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return 30_000;
  }

  return parsed;
}

async function fetchWithTimeout(
  runtime: IAgentRuntime,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  meta: Record<string, unknown>
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    logger.info({ url, timeoutMs, ...meta }, "Calling Misoki HTTP endpoint");
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    logger.info(
      { url, timeoutMs, durationMs: Date.now() - startedAt, status: response.status, ...meta },
      "Misoki HTTP endpoint returned"
    );
    return response;
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Timed out after ${timeoutMs}ms calling ${url}`
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error({ error, url, timeoutMs, durationMs: Date.now() - startedAt, ...meta }, "Misoki HTTP endpoint failed");
    throw new Error(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Analysis service returned invalid JSON: ${body.slice(0, 500)}`);
  }
}

export async function analyzeRepo(
  runtime: IAgentRuntime,
  payload: { githubUrl: string; maxFiles?: number; includeCategories?: string[] }
): Promise<AnalyzeRepoResponse> {
  const baseUrl = getAnalysisServiceBaseUrl(runtime);
  const maxFiles = payload.maxFiles ?? getAnalysisMaxFiles(runtime);
  const timeoutMs = getAnalysisTimeoutMs(runtime);
  const url = `${baseUrl}/analyze/repo`;
  const response = await fetchWithTimeout(
    runtime,
    url,
    {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      github_url: payload.githubUrl,
      max_files: maxFiles,
      include_categories: payload.includeCategories,
    }),
    },
    timeoutMs,
    {
      githubUrl: payload.githubUrl,
      maxFiles,
      includeCategories: payload.includeCategories,
    }
  );

  const parsed = await parseJsonResponse<AnalyzeRepoResponse | { detail?: string }>(response);
  if (!response.ok) {
    const detail =
      "detail" in parsed && typeof parsed.detail === "string" ? parsed.detail : "Unknown error";
    throw new Error(`Analysis service error ${response.status}: ${detail}`);
  }

  return parsed as AnalyzeRepoResponse;
}

export async function previewFix(
  runtime: IAgentRuntime,
  payload: { githubUrl: string; fixId: string }
): Promise<PreviewFixResponse> {
  const baseUrl = getAnalysisServiceBaseUrl(runtime);
  const timeoutMs = getAnalysisTimeoutMs(runtime);
  const url = `${baseUrl}/preview/fix`;
  const response = await fetchWithTimeout(
    runtime,
    url,
    {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      github_url: payload.githubUrl,
      fix_id: payload.fixId,
    }),
    },
    timeoutMs,
    {
      githubUrl: payload.githubUrl,
      fixId: payload.fixId,
    }
  );

  const parsed = await parseJsonResponse<PreviewFixResponse | { detail?: string }>(response);
  if (!response.ok) {
    const detail =
      "detail" in parsed && typeof parsed.detail === "string" ? parsed.detail : "Unknown error";
    throw new Error(`Preview service error ${response.status}: ${detail}`);
  }

  return parsed as PreviewFixResponse;
}
