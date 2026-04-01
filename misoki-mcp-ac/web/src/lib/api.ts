import type { ApplyFixResponse, BatchPreviewResponse, PreviewFixResponse, RepoAnalyzeResponse } from "./types";

function getBaseUrl(): string {
    // Always route through the Next.js rewrite proxy (/api/analysis → analysis
    // service). This avoids the browser trying to resolve a Docker-internal
    // hostname (http://analysis-service:8000 or http://host.docker.internal:8000)
    // that is only reachable by the Next.js server process, not the browser.
    //
    // In local dev:   browser → /api/analysis/* → Next.js → http://localhost:8000/*
    // In Docker:      browser → /api/analysis/* → Next.js → http://analysis-service:8000/*
    return "/api/analysis";
}

async function post<T>(path: string, body: unknown): Promise<T> {
    const url = `${getBaseUrl()}${path}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`Service returned invalid JSON: ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
        const detail =
            parsed &&
                typeof parsed === "object" &&
                "detail" in parsed &&
                typeof (parsed as Record<string, unknown>).detail === "string"
                ? (parsed as Record<string, string>).detail
                : text.slice(0, 300);
        throw new Error(`API error ${res.status}: ${detail}`);
    }

    return parsed as T;
}

export type AnalyzeOptions = {
    branch?: string;
    maxFiles?: number;
    includeCategories?: string[];
};

export async function analyzeRepo(
    githubUrl: string,
    options: AnalyzeOptions = {}
): Promise<RepoAnalyzeResponse> {
    return post<RepoAnalyzeResponse>("/analyze/repo", {
        github_url: githubUrl,
        branch: options.branch ?? null,
        max_files: options.maxFiles ?? 40,
        include_categories: options.includeCategories ?? [
            "architecture",
            "dead_code",
            "duplication",
            "performance",
            "type_hints",
        ],
    });
}

export async function previewFix(
    githubUrl: string,
    fixId: string,
    branch?: string
): Promise<PreviewFixResponse> {
    return post<PreviewFixResponse>("/preview/fix", {
        github_url: githubUrl,
        fix_id: fixId,
        branch: branch ?? null,
    });
}

export async function previewBatchFixes(
    githubUrl: string,
    fixIds: string[],
    branch?: string
): Promise<BatchPreviewResponse> {
    return post<BatchPreviewResponse>("/preview/batch", {
        github_url: githubUrl,
        fix_ids: fixIds,
        branch: branch ?? null,
    });
}

export async function applySafeFixes(
    githubUrl: string,
    fixIds: string[],
    branch?: string
): Promise<ApplyFixResponse> {
    return post<ApplyFixResponse>("/apply/fixes", {
        github_url: githubUrl,
        fix_ids: fixIds,
        branch: branch ?? null,
    });
}
