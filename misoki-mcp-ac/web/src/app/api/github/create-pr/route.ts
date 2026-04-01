/**
 * Next.js API route: /api/github/create-pr
 *
 * Creates a draft PR on GitHub directly from the frontend patch results.
 * Runs server-side so it can read GITHUB_TOKEN from the environment.
 *
 * Flow:
 *   1. Validate token scopes (need `public_repo` or `repo`).
 *   2. Check if the token owner has push access to the repo.
 *   3. If not, fork the repo (or reuse an existing fork).
 *   4. Create a branch, push the patched files, and open a cross-fork
 *      draft PR back to the upstream repo.
 */
import { NextResponse, type NextRequest } from "next/server";

type FilePatch = {
    file: string;
    modified: string;
};

type CreatePrPayload = {
    github_url: string;
    base_branch: string;
    branch_name: string;
    title: string;
    body: string;
    files: FilePatch[];
};

type RepoRef = { owner: string; repo: string };

const GITHUB_API = "https://api.github.com";

function getToken(): string {
    const token =
        process.env.GITHUB_TOKEN ??
        process.env.MISOKI_GITHUB_TOKEN ??
        process.env.GH_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is not configured on the server.");
    return token;
}

function parseRepoUrl(url: string): RepoRef {
    const m = url.match(
        /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i
    );
    if (!m) throw new Error("Invalid GitHub URL");
    return { owner: m[1], repo: m[2] };
}

/** Tagged fetch — every error includes which step failed */
async function ghFetch<T>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
    step?: string
): Promise<T> {
    const res = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "misoki-web",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* ignore */ }

    if (!res.ok) {
        const ghMsg = parsed?.message ?? text.slice(0, 300);
        const label = step ? ` [${step}]` : "";
        throw new Error(`GitHub ${res.status}${label}: ${ghMsg}`);
    }
    return parsed as T;
}

async function ghFetchRaw(
    token: string,
    method: string,
    path: string,
    body?: unknown
): Promise<Response> {
    return fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "misoki-web",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

function sanitizeBranch(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9/_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-/]+|[-/]+$/g, "")
        .slice(0, 120);
}

/**
 * Verify the token can perform write operations.
 * Classic PATs expose scopes via x-oauth-scopes header.
 * Fine-grained PATs don't expose this header but return 200 on /user.
 */
async function validateTokenAccess(token: string): Promise<{
    login: string;
    tokenType: "classic" | "fine-grained";
    hasWriteScope: boolean;
    scopes: string;
}> {
    const res = await ghFetchRaw(token, "GET", "/user");
    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `Token validation failed (${res.status}): Cannot authenticate. ` +
            `Ensure GITHUB_TOKEN is a valid PAT. Response: ${text.slice(0, 200)}`
        );
    }
    const user = (await res.json()) as { login: string };
    const scopes = res.headers.get("x-oauth-scopes") ?? "";

    // Classic PATs have x-oauth-scopes header; fine-grained PATs don't
    const isClassic = scopes !== "" || res.headers.has("x-oauth-scopes");

    let hasWriteScope = true;
    if (isClassic) {
        const scopeList = scopes.split(",").map((s) => s.trim().toLowerCase());
        hasWriteScope =
            scopeList.includes("repo") || scopeList.includes("public_repo");
    }

    return {
        login: user.login,
        tokenType: isClassic ? "classic" : "fine-grained",
        hasWriteScope,
        scopes,
    };
}

async function hasPushAccess(
    token: string,
    ref: RepoRef
): Promise<boolean> {
    const res = await ghFetchRaw(token, "GET", `/repos/${ref.owner}/${ref.repo}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { permissions?: { push?: boolean } };
    return data?.permissions?.push === true;
}

async function ensureFork(
    token: string,
    upstream: RepoRef,
    myLogin: string
): Promise<RepoRef> {
    // Check if user already has a fork (could be named differently)
    const res = await ghFetchRaw(
        token,
        "GET",
        `/repos/${myLogin}/${upstream.repo}`
    );
    if (res.ok) {
        const data = (await res.json()) as {
            fork: boolean;
            owner: { login: string };
            name: string;
        };
        if (data.fork) {
            return { owner: data.owner.login, repo: data.name };
        }
    }

    // Also check forks list in case the fork was renamed
    const forksRes = await ghFetchRaw(
        token,
        "GET",
        `/repos/${upstream.owner}/${upstream.repo}/forks?per_page=100`
    );
    if (forksRes.ok) {
        const forks = (await forksRes.json()) as Array<{
            owner: { login: string };
            name: string;
        }>;
        const mine = forks.find(
            (f) => f.owner.login.toLowerCase() === myLogin.toLowerCase()
        );
        if (mine) {
            return { owner: mine.owner.login, repo: mine.name };
        }
    }

    // Create new fork
    const fork = await ghFetch<{ owner: { login: string }; name: string }>(
        token,
        "POST",
        `/repos/${upstream.owner}/${upstream.repo}/forks`,
        { default_branch_only: true },
        "fork repo"
    );

    // GitHub forks are async — wait for the git data to be ready (up to 60s)
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const check = await ghFetchRaw(
            token,
            "GET",
            `/repos/${fork.owner.login}/${fork.name}/git/refs/heads`
        );
        if (check.ok) {
            const refs = (await check.json()) as unknown[];
            if (refs.length > 0) break;
        }
    }

    return { owner: fork.owner.login, repo: fork.name };
}

export async function POST(req: NextRequest) {
    try {
        const payload = (await req.json()) as CreatePrPayload;
        if (!payload.files?.length) {
            return NextResponse.json(
                { error: "No files to commit." },
                { status: 400 }
            );
        }

        const token = getToken();
        const upstream = parseRepoUrl(payload.github_url);

        // Step 1: Validate token and check scopes
        const tokenInfo = await validateTokenAccess(token);
        if (!tokenInfo.hasWriteScope) {
            return NextResponse.json(
                {
                    error:
                        `Your GitHub token (${tokenInfo.tokenType} PAT for @${tokenInfo.login}) ` +
                        `is missing write scopes. Current scopes: "${tokenInfo.scopes}". ` +
                        `Please add the "public_repo" scope (Settings → Developer settings → Personal access tokens → Edit).`,
                },
                { status: 403 }
            );
        }

        // Step 2: Get base branch
        const repoInfo = await ghFetch<{ default_branch: string }>(
            token,
            "GET",
            `/repos/${upstream.owner}/${upstream.repo}`,
            undefined,
            "get repo info"
        );
        const baseBranch = payload.base_branch || repoInfo.default_branch;

        // Step 3: Check push access
        const canPush = await hasPushAccess(token, upstream);

        let workRepo: RepoRef;
        if (canPush) {
            workRepo = upstream;
        } else {
            workRepo = await ensureFork(token, upstream, tokenInfo.login);
        }

        // Step 4: Get the base SHA from the upstream branch
        const baseSha = (
            await ghFetch<{ object: { sha: string } }>(
                token,
                "GET",
                `/repos/${upstream.owner}/${upstream.repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
                undefined,
                "get base branch SHA"
            )
        ).object.sha;

        const branchName = sanitizeBranch(payload.branch_name);

        // Step 5: Sync fork default branch if needed (fork might be behind upstream)
        if (workRepo.owner !== upstream.owner) {
            // Merge upstream into fork's default branch to ensure we have the latest SHA
            await ghFetchRaw(token, "POST", `/repos/${workRepo.owner}/${workRepo.repo}/merge-upstream`, {
                branch: baseBranch,
            });
            // Small delay for GitHub to process the sync
            await new Promise((r) => setTimeout(r, 1500));
        }

        // Step 6: Create the branch on the work repo (fork or upstream)
        await ghFetch(
            token,
            "POST",
            `/repos/${workRepo.owner}/${workRepo.repo}/git/refs`,
            { ref: `refs/heads/${branchName}`, sha: baseSha },
            `create branch "${branchName}" on ${workRepo.owner}/${workRepo.repo}`
        );

        // Step 7: Push each patched file
        for (const file of payload.files) {
            const encodedPath = file.file
                .split("/")
                .map(encodeURIComponent)
                .join("/");

            const fileSha = (
                await ghFetch<{ sha: string }>(
                    token,
                    "GET",
                    `/repos/${workRepo.owner}/${workRepo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`,
                    undefined,
                    `get file SHA for ${file.file}`
                )
            ).sha;

            await ghFetch(
                token,
                "PUT",
                `/repos/${workRepo.owner}/${workRepo.repo}/contents/${encodedPath}`,
                {
                    message: `chore: apply Misoki safe fix to ${file.file}`,
                    content: Buffer.from(file.modified, "utf-8").toString("base64"),
                    branch: branchName,
                    sha: fileSha,
                },
                `commit patch to ${file.file}`
            );
        }

        // Step 8: Open a draft PR — cross-fork if we used a fork
        const head =
            workRepo.owner === upstream.owner
                ? branchName
                : `${workRepo.owner}:${branchName}`;

        const pr = await ghFetch<{ html_url: string; number: number }>(
            token,
            "POST",
            `/repos/${upstream.owner}/${upstream.repo}/pulls`,
            {
                title: payload.title,
                body: payload.body,
                base: baseBranch,
                head,
                draft: true,
            },
            "create pull request"
        );

        return NextResponse.json({
            pr_url: pr.html_url,
            pr_number: pr.number,
            branch: branchName,
            base_branch: baseBranch,
            forked: workRepo.owner !== upstream.owner,
            work_repo: `${workRepo.owner}/${workRepo.repo}`,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("GITHUB_TOKEN") ? 500 : 502;
        return NextResponse.json({ error: msg }, { status });
    }
}
