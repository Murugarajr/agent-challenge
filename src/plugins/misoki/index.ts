import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Plugin,
  State,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import { randomUUID } from "node:crypto";

import {
  analyzeRepo,
  applySafeFixes,
  previewFix,
  type AnalysisIssue,
  type AnalyzeRepoResponse,
  type ApplyFixResponse,
} from "./lib/client";
import {
  formatAnalysisSummary,
  formatApplySummary,
  formatFileDetailsSummary,
  formatFindingExplanation,
  formatPrDraftSummary,
  formatPreviewSummary,
  formatRefactorPlan,
  formatTopIssuesSummary,
} from "./lib/formatters";
import { createGitHubPrFromPatches } from "./lib/github";

const GITHUB_URL_RE = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?/i;
const FIX_ID_RE = /\b[a-z_]+:[^:\s]+(?:\/[^:\s]+)*:\d+:[a-z_]+\b/i;
const inFlightRepoAnalyses = new Map<string, { actionId: string; startedAt: number }>();
const latestAnalysisByRoom = new Map<string, CachedAnalysis>();
const latestApplyByRoom = new Map<string, CachedApplyResult>();
const lastRepoUrlByRoom = new Map<string, string>();
const CHAT_ANALYSIS_CATEGORIES = ["architecture", "dead_code", "performance"];
const TOP_ISSUES_RE = /\b(top|biggest|worst|findings|issues|critical|warning|performance|architecture|dead\s*code)\b/i;
const FILE_DETAILS_RE = /\b(file|module|details|worst file|top file|most issues|focus on)\b/i;
const EXPLAIN_FINDING_RE = /\b(explain|what does|what is|why is|why does|tell me more|mean)\b/i;
const REFACTOR_PLAN_RE = /\b(refactor plan|roadmap|prioriti[sz]e|fix first|first step|next step|what should i fix first)\b/i;
const APPLY_SAFE_FIXES_RE = /\b(apply safe fixes|apply fixes|safe fixes|quick wins|apply cleanup)\b/i;
const CREATE_PR_RE = /\b(create pr|pull request|draft pr|prepare pr)\b/i;
const QUERY_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "analysis",
  "architecture",
  "because",
  "code",
  "create",
  "dead",
  "details",
  "does",
  "explain",
  "file",
  "finding",
  "findings",
  "first",
  "fix",
  "issue",
  "issues",
  "more",
  "next",
  "performance",
  "plan",
  "please",
  "prioritize",
  "prioritise",
  "refactor",
  "repository",
  "show",
  "tell",
  "that",
  "this",
  "top",
  "what",
  "which",
  "why",
  "with",
  "worst",
]);

type CachedAnalysis = AnalyzeRepoResponse & {
  cachedAt: number;
};

type CachedApplyResult = {
  response: ApplyFixResponse;
  createdAt: number;
};

function getMessageText(message: Memory): string {
  const text = message.content?.text;
  return typeof text === "string" ? text : "";
}

function extractGithubUrl(text: string): string | null {
  const match = text.match(GITHUB_URL_RE);
  return match ? match[0] : null;
}

function extractFixId(text: string): string | null {
  const match = text.match(FIX_ID_RE);
  return match ? match[0] : null;
}

function wantsPreview(text: string): boolean {
  return /\b(preview|show\s+diff|diff)\b/i.test(text);
}

async function respond(
  message: Memory,
  callback: HandlerCallback | undefined,
  text: string,
  action: string
): Promise<void> {
  if (!callback) {
    return;
  }

  await callback({
    text,
    actions: [action],
    source: message.content.source,
  });
}

function getMessageSource(message: Memory): string {
  return typeof message.content?.source === "string" && message.content.source.length > 0
    ? message.content.source
    : "unknown";
}

function getBackgroundAnalysisMaxFiles(runtime: IAgentRuntime): number {
  const rawValue = runtime.getSetting("MISOKI_ANALYSIS_MAX_FILES");
  const normalized = rawValue !== null && rawValue !== undefined ? String(rawValue).trim() : "";
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }

  return parsed;
}

function getRepoAnalysisKey(message: Memory, githubUrl: string): string {
  return `${message.roomId}:${githubUrl.toLowerCase()}`;
}

function cacheAnalysis(roomId: string, result: AnalyzeRepoResponse): void {
  latestAnalysisByRoom.set(roomId, {
    ...result,
    cachedAt: Date.now(),
  });
  latestApplyByRoom.delete(roomId);
  lastRepoUrlByRoom.set(roomId, result.repo);
}

function rememberRepoUrl(roomId: string, url: string): void {
  lastRepoUrlByRoom.set(roomId, url);
}

function getLastRepoUrl(roomId: string): string | null {
  return lastRepoUrlByRoom.get(roomId) ?? null;
}

function getCachedAnalysis(roomId: string): CachedAnalysis | null {
  return latestAnalysisByRoom.get(roomId) ?? null;
}

function cacheApplyResult(roomId: string, response: ApplyFixResponse): void {
  latestApplyByRoom.set(roomId, {
    response,
    createdAt: Date.now(),
  });
}

function getCachedApplyResult(roomId: string): CachedApplyResult | null {
  return latestApplyByRoom.get(roomId) ?? null;
}

function getRepoName(githubUrl: string): string {
  const parts = githubUrl.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || "repo";
}

function severityRank(severity: string): number {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function sortIssues(issues: AnalysisIssue[]): AnalysisIssue[] {
  return [...issues].sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      left.file.localeCompare(right.file) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.title.localeCompare(right.title)
  );
}

function extractRequestedIssueCount(text: string, fallback = 5): number {
  const match =
    text.match(/\b(?:top|show|list)\s+(\d{1,2})\b/i) ??
    text.match(/\b(\d{1,2})\s+(?:issues|findings)\b/i);
  const parsed = match ? Number.parseInt(match[1], 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, 10);
}

function extractCategoryFilter(text: string): string | null {
  if (/\barchitecture\b/i.test(text)) {
    return "architecture";
  }
  if (/\bperformance\b/i.test(text)) {
    return "performance";
  }
  if (/\bdead\s*code\b/i.test(text)) {
    return "dead_code";
  }
  return null;
}

function extractSeverityFilter(text: string): string | null {
  if (/\bcritical\b/i.test(text)) {
    return "critical";
  }
  if (/\bwarning\b/i.test(text)) {
    return "warning";
  }
  if (/\binfo\b/i.test(text)) {
    return "info";
  }
  return null;
}

function getAnalysisFiles(analysis: AnalyzeRepoResponse): string[] {
  return [...new Set(analysis.issues.map((issue) => issue.file))];
}

function getTopFile(analysis: AnalyzeRepoResponse): string | null {
  const weights = new Map<string, number>();
  for (const issue of analysis.issues) {
    weights.set(issue.file, (weights.get(issue.file) ?? 0) + severityRank(issue.severity));
  }

  let bestFile: string | null = null;
  let bestWeight = -1;
  for (const [file, weight] of weights.entries()) {
    if (weight > bestWeight) {
      bestFile = file;
      bestWeight = weight;
    }
  }

  return bestFile;
}

function extractReferencedFile(text: string, analysis: AnalyzeRepoResponse): string | null {
  const normalized = text.toLowerCase();
  const files = getAnalysisFiles(analysis);

  for (const file of files) {
    if (normalized.includes(file.toLowerCase())) {
      return file;
    }
  }

  const basenameMatches = new Map<string, string[]>();
  for (const file of files) {
    const basename = file.split("/").pop()?.toLowerCase();
    if (!basename) {
      continue;
    }
    basenameMatches.set(basename, [...(basenameMatches.get(basename) ?? []), file]);
  }

  for (const [basename, matchingFiles] of basenameMatches.entries()) {
    if (normalized.includes(basename) && matchingFiles.length === 1) {
      return matchingFiles[0];
    }
  }

  if (/\b(worst file|top file|most issues|focus on the file|which file)\b/i.test(text)) {
    return getTopFile(analysis);
  }

  return files.length === 1 ? files[0] : null;
}

function extractLineNumber(text: string): number | null {
  const match = text.match(/\bline\s+(\d+)\b/i) ?? text.match(/:(\d+)\b/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !QUERY_STOPWORDS.has(token));
}

function findMatchingIssue(text: string, analysis: AnalyzeRepoResponse): AnalysisIssue | null {
  const fixId = extractFixId(text);
  if (fixId) {
    return analysis.issues.find((issue) => issue.fix_id === fixId) ?? null;
  }

  const referencedFile = extractReferencedFile(text, analysis);
  const referencedLine = extractLineNumber(text);
  if (referencedFile && referencedLine !== null) {
    return (
      analysis.issues.find((issue) => issue.file === referencedFile && issue.line === referencedLine) ??
      null
    );
  }

  const tokens = tokenizeQuery(text);
  if (tokens.length === 0) {
    return referencedFile
      ? sortIssues(analysis.issues.filter((issue) => issue.file === referencedFile))[0] ?? null
      : sortIssues(analysis.issues)[0] ?? null;
  }

  let bestIssue: AnalysisIssue | null = null;
  let bestScore = 0;

  for (const issue of analysis.issues) {
    const haystack = `${issue.file} ${issue.title} ${issue.details} ${issue.source_type} ${issue.category}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 1;
      }
    }

    if (referencedFile && issue.file === referencedFile) {
      score += 2;
    }

    if (score > bestScore) {
      bestIssue = issue;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestIssue : null;
}

function buildPrDraft(
  analysis: AnalyzeRepoResponse,
  applyResult: ApplyFixResponse | null
): {
  branchName: string;
  title: string;
  body: string;
  changedFiles: string[];
  appliedCount: number;
} {
  const repoName = getRepoName(analysis.repo);
  const timestamp = new Date().toISOString().slice(0, 10);
  const changedFiles = applyResult?.files.map((file) => file.file) ?? [];
  const appliedCount = applyResult?.applied_count ?? 0;
  const title =
    appliedCount > 0
      ? `chore(${repoName}): apply Misoki safe fixes`
      : `chore(${repoName}): draft Misoki refactor follow-up`;
  const branchName = `misoki/${repoName}-safe-fixes-${timestamp}`;
  const bodyLines = [
    "## Summary",
    "",
    `- Repo analyzed: ${analysis.repo}`,
    `- Commit analyzed: ${analysis.commit}`,
    `- Findings summary: critical=${analysis.summary.critical}, warning=${analysis.summary.warning}, info=${analysis.summary.info}`,
    appliedCount > 0 ? `- Safe fixes applied: ${appliedCount}` : "- Safe fixes applied: 0",
    changedFiles.length > 0 ? `- Changed files: ${changedFiles.join(", ")}` : "- Changed files: none",
    "",
    "## Included changes",
    "",
    ...(appliedCount > 0
      ? applyResult!.applied_fix_ids.map((fixId) => `- ${fixId}`)
      : ["- No automated patches are attached in this draft."]),
    "",
    "## Follow-up",
    "",
    "- Review the generated patch carefully before opening a real PR.",
    "- Re-run repository analysis after applying safe fixes.",
    "- Tackle the highest-severity architectural findings next.",
  ];

  return {
    branchName,
    title,
    body: bodyLines.join("\n"),
    changedFiles,
    appliedCount,
  };
}

type MessageBusServiceLike = {
  sendAgentResponseToBus?: (
    agentRoomId: string,
    agentWorldId: string,
    content: Record<string, unknown>,
    inReplyToAgentMemoryId?: string,
    originalMessage?: unknown
  ) => Promise<unknown>;
};

async function emitBackgroundActionUpdate(
  runtime: IAgentRuntime,
  message: Memory,
  actionId: string,
  status: "executing" | "completed" | "failed",
  text: string,
  actionResult?: ActionResult
): Promise<void> {
  const room = await runtime.getRoom(message.roomId);
  const worldId = message.worldId ?? room?.worldId ?? message.roomId;
  const source = getMessageSource(message);
  const eventName = status === "executing" ? "ACTION_STARTED" : "ACTION_COMPLETED";

  await (runtime.emitEvent as (event: string, params: unknown) => Promise<void>)(eventName, {
    runtime,
    source: "misoki-plugin",
    messageId: actionId,
    roomId: message.roomId,
    world: worldId,
    content: {
      text,
      actions: ["ANALYSE_REPO"],
      actionStatus: status,
      actionId,
      type: "agent_action",
      source,
      actionResult,
    },
  });
}

async function postChatSummary(runtime: IAgentRuntime, message: Memory, text: string): Promise<void> {
  const room = await runtime.getRoom(message.roomId);
  const worldId = message.worldId ?? room?.worldId ?? message.roomId;
  const responseId = randomUUID();
  const content = {
    text,
    source: getMessageSource(message),
    responseId,
  };

  await runtime.createMemory(
    {
      id: responseId,
      entityId: runtime.agentId,
      roomId: message.roomId,
      worldId,
      agentId: runtime.agentId,
      content,
    },
    "messages"
  );

  const messageBusService = runtime.getService("message-bus-service") as MessageBusServiceLike | null;
  if (messageBusService?.sendAgentResponseToBus) {
    await messageBusService.sendAgentResponseToBus(
      message.roomId,
      worldId,
      content,
      message.id,
      message as unknown
    );
  } else {
    logger.warn({ roomId: message.roomId }, "Message bus service not available for Misoki chat summary");
  }
}

function runAnalyzeRepoInBackground(runtime: IAgentRuntime, message: Memory, githubUrl: string): void {
  rememberRepoUrl(message.roomId, githubUrl);
  void (async () => {
    const actionId = randomUUID();
    const analysisKey = getRepoAnalysisKey(message, githubUrl);
    const maxFiles = getBackgroundAnalysisMaxFiles(runtime);
    inFlightRepoAnalyses.set(analysisKey, { actionId, startedAt: Date.now() });

    try {
      logger.info({ githubUrl, roomId: message.roomId, actionId, maxFiles }, "Starting Misoki background analysis");
      await emitBackgroundActionUpdate(
        runtime,
        message,
        actionId,
        "executing",
        `Analyzing ${githubUrl} in the background...`
      );

      logger.info(
        { githubUrl, roomId: message.roomId, actionId, maxFiles, includeCategories: CHAT_ANALYSIS_CATEGORIES },
        "Calling Misoki analysis service"
      );
      const result = await analyzeRepo(runtime, {
        githubUrl,
        maxFiles,
        includeCategories: CHAT_ANALYSIS_CATEGORIES,
      });
      logger.info(
        { githubUrl, roomId: message.roomId, actionId, maxFiles, issueCount: result.issues.length },
        "Misoki analysis service returned successfully"
      );
      cacheAnalysis(message.roomId, result);
      const summary = formatAnalysisSummary(result);
      logger.info({ githubUrl, roomId: message.roomId, actionId }, "Publishing completed Misoki action update");
      await emitBackgroundActionUpdate(runtime, message, actionId, "completed", summary, {
        success: true,
        text: summary,
        data: {
          actionName: "ANALYSE_REPO",
          repo: result.repo,
          commit: result.commit,
          summary: result.summary,
          // Limit issues to 15 to prevent context memory blowout in ElizaOS (SQLite state)
          issues: result.issues.slice(0, 15),
        },
      });
      await postChatSummary(runtime, message, summary);
      logger.info(
        { githubUrl, roomId: message.roomId, actionId, maxFiles, issueCount: result.issues.length },
        "Completed Misoki background analysis"
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error({ error, githubUrl, roomId: message.roomId, actionId, maxFiles }, "Misoki background analysis failed");
      await emitBackgroundActionUpdate(
        runtime,
        message,
        actionId,
        "failed",
        `Analysis failed: ${messageText}`,
        {
          success: false,
          error: messageText,
          data: {
            actionName: "ANALYSE_REPO",
            repo: githubUrl,
          },
        }
      );
      await postChatSummary(runtime, message, `Analysis failed: ${messageText}`);
    } finally {
      inFlightRepoAnalyses.delete(analysisKey);
    }
  })();
}

const analyzeRepoAction: Action = {
  name: "ANALYSE_REPO",
  similes: ["ANALYZE_REPO", "REVIEW_REPO", "CHECK_REPO", "ANALYSE_CODEBASE"],
  description:
    "Analyze a public GitHub Python repository using the Misoki analysis service and summarize the most important findings.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    return extractGithubUrl(text) !== null || getLastRepoUrl(message.roomId) !== null;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const text = getMessageText(message);
      const githubUrl = extractGithubUrl(text) ?? getLastRepoUrl(message.roomId);
      if (!githubUrl) {
        throw new Error("No GitHub repository URL found in the message.");
      }

      const analysisKey = getRepoAnalysisKey(message, githubUrl);
      const existingRun = inFlightRepoAnalyses.get(analysisKey);
      if (existingRun) {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - existingRun.startedAt) / 1000));
        const alreadyRunningText =
          `Repository analysis for ${githubUrl} is already running in this chat. ` +
          `Current run started about ${elapsedSeconds}s ago. I'll post the results here when it finishes.`;
        return {
          success: true,
          text: alreadyRunningText,
          data: {
            repo: githubUrl,
            mode: "background",
            deduped: true,
            actionId: existingRun.actionId,
          },
        };
      }

      runAnalyzeRepoInBackground(runtime, message, githubUrl);

      return {
        success: true,
        text: "",
        data: {
          repo: githubUrl,
          mode: "background",
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error({ error }, "Misoki analysis action failed");
      await respond(message, callback, `Analysis failed: ${messageText}`, "ANALYSE_REPO");
      return {
        success: false,
        error: messageText,
      };
    }
  },
  examples: [
    [
      {
        name: "{{userName}}",
        content: {
          text: "Analyze https://github.com/pallets/flask and show me the biggest code quality issues.",
          actions: [],
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Analyzed the repository and summarized the top findings with any previewable fix IDs.",
          actions: ["ANALYSE_REPO"],
        },
      },
    ],
  ],
};

const previewFixAction: Action = {
  name: "PREVIEW_FIX",
  similes: ["SHOW_FIX", "SHOW_DIFF", "PREVIEW_DIFF"],
  description:
    "Preview a fix from the Misoki analysis service using a fix_id from a previous analysis result.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    return wantsPreview(text) && extractFixId(text) !== null && extractGithubUrl(text) !== null;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const text = getMessageText(message);
      const githubUrl = extractGithubUrl(text);
      const fixId = extractFixId(text);
      if (!githubUrl || !fixId) {
        throw new Error("A GitHub URL and valid fix_id are required to preview a fix.");
      }

      const result = await previewFix(runtime, { githubUrl, fixId });
      const summary = formatPreviewSummary(result, fixId);
      await respond(message, callback, summary, "PREVIEW_FIX");

      return {
        success: true,
        text: summary,
        data: {
          fixId,
          file: result.file,
          supported: result.supported,
          risk: result.risk,
          diff: result.diff,
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error({ error }, "Misoki preview action failed");
      await respond(message, callback, `Preview failed: ${messageText}`, "PREVIEW_FIX");
      return {
        success: false,
        error: messageText,
      };
    }
  },
  examples: [
    [
      {
        name: "{{userName}}",
        content: {
          text: "Preview fix dead_code:src/flask/app.py:1:unused_import for https://github.com/pallets/flask",
          actions: [],
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Previewed the requested fix and showed the diff snippet.",
          actions: ["PREVIEW_FIX"],
        },
      },
    ],
  ],
};

const showTopIssuesAction: Action = {
  name: "SHOW_TOP_ISSUES",
  similes: ["LIST_TOP_ISSUES", "SHOW_FINDINGS", "SHOW_CRITICAL_ISSUES"],
  description:
    "Show the top findings from the most recent Misoki repo analysis in this chat, optionally filtered by severity or category.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    const hasContext = getCachedAnalysis(message.roomId) !== null || getLastRepoUrl(message.roomId) !== null;
    return hasContext && extractGithubUrl(text) === null && TOP_ISSUES_RE.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      let analysis = getCachedAnalysis(message.roomId);
      if (!analysis) {
        const repoUrl = getLastRepoUrl(message.roomId);
        if (repoUrl) {
          await respond(message, callback, `Re-analyzing ${repoUrl} to get the findings...`, "SHOW_TOP_ISSUES");
          const result = await analyzeRepo(runtime, {
            githubUrl: repoUrl,
            maxFiles: getBackgroundAnalysisMaxFiles(runtime),
            includeCategories: CHAT_ANALYSIS_CATEGORIES,
          });
          cacheAnalysis(message.roomId, result);
          analysis = getCachedAnalysis(message.roomId);
        }
      }
      if (!analysis) {
        throw new Error("No repository analysis is cached for this chat yet. Send a GitHub URL first.");
      }

      const text = getMessageText(message);
      const requestedCount = extractRequestedIssueCount(text);
      const severityFilter = extractSeverityFilter(text);
      const categoryFilter = extractCategoryFilter(text);
      const filteredIssues = sortIssues(
        analysis.issues.filter(
          (issue) =>
            (!severityFilter || issue.severity === severityFilter) &&
            (!categoryFilter || issue.category === categoryFilter)
        )
      );

      const labelParts = [
        "Top findings",
        severityFilter ? `(${severityFilter})` : "",
        categoryFilter ? `[${categoryFilter}]` : "",
      ].filter(Boolean);
      const summary = formatTopIssuesSummary(
        analysis,
        filteredIssues.slice(0, requestedCount),
        labelParts.join(" ")
      );
      await respond(message, callback, summary, "SHOW_TOP_ISSUES");

      return {
        success: true,
        text: summary,
        data: {
          repo: analysis.repo,
          commit: analysis.commit,
          count: Math.min(filteredIssues.length, requestedCount),
          severityFilter,
          categoryFilter,
          issues: filteredIssues.slice(0, requestedCount),
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await respond(message, callback, `Top issues unavailable: ${messageText}`, "SHOW_TOP_ISSUES");
      return {
        success: false,
        error: messageText,
      };
    }
  },
};

const showFileDetailsAction: Action = {
  name: "SHOW_FILE_DETAILS",
  similes: ["SHOW_MODULE_DETAILS", "SHOW_WORST_FILE", "FOCUS_ON_FILE"],
  description:
    "Show the findings for a specific file from the most recent Misoki analysis in this chat.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    const hasContext = getCachedAnalysis(message.roomId) !== null || getLastRepoUrl(message.roomId) !== null;
    return hasContext && extractGithubUrl(text) === null && FILE_DETAILS_RE.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      let analysis = getCachedAnalysis(message.roomId);
      if (!analysis) {
        const repoUrl = getLastRepoUrl(message.roomId);
        if (repoUrl) {
          await respond(message, callback, `Re-analyzing ${repoUrl} to get file details...`, "SHOW_FILE_DETAILS");
          const result = await analyzeRepo(runtime, {
            githubUrl: repoUrl,
            maxFiles: getBackgroundAnalysisMaxFiles(runtime),
            includeCategories: CHAT_ANALYSIS_CATEGORIES,
          });
          cacheAnalysis(message.roomId, result);
          analysis = getCachedAnalysis(message.roomId);
        }
      }
      if (!analysis) {
        throw new Error("No repository analysis is cached for this chat yet. Send a GitHub URL first.");
      }

      const filePath = extractReferencedFile(getMessageText(message), analysis);
      if (!filePath) {
        throw new Error("I couldn't determine which analyzed file you mean.");
      }

      const fileIssues = sortIssues(analysis.issues.filter((issue) => issue.file === filePath));
      const summary = formatFileDetailsSummary(analysis, filePath, fileIssues);
      await respond(message, callback, summary, "SHOW_FILE_DETAILS");

      return {
        success: true,
        text: summary,
        data: {
          repo: analysis.repo,
          commit: analysis.commit,
          file: filePath,
          issues: fileIssues,
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await respond(message, callback, `File details unavailable: ${messageText}`, "SHOW_FILE_DETAILS");
      return {
        success: false,
        error: messageText,
      };
    }
  },
};

const explainFindingAction: Action = {
  name: "EXPLAIN_FINDING",
  similes: ["EXPLAIN_ISSUE", "DETAIL_FINDING", "WHY_IS_THIS_BAD"],
  description:
    "Explain a finding from the most recent Misoki analysis using a fix_id, file:line reference, or title keywords.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    const hasContext = getCachedAnalysis(message.roomId) !== null || getLastRepoUrl(message.roomId) !== null;
    return (
      hasContext &&
      extractGithubUrl(text) === null &&
      (extractFixId(text) !== null || EXPLAIN_FINDING_RE.test(text))
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const analysis = getCachedAnalysis(message.roomId);
      if (!analysis) {
        throw new Error("No repository analysis is cached for this chat yet.");
      }

      const issue = findMatchingIssue(getMessageText(message), analysis);
      if (!issue) {
        throw new Error("I couldn't match that request to a finding from the latest analysis.");
      }

      const summary = formatFindingExplanation(issue);
      await respond(message, callback, summary, "EXPLAIN_FINDING");

      return {
        success: true,
        text: summary,
        data: {
          repo: analysis.repo,
          commit: analysis.commit,
          issue,
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await respond(message, callback, `Explanation unavailable: ${messageText}`, "EXPLAIN_FINDING");
      return {
        success: false,
        error: messageText,
      };
    }
  },
};

const createRefactorPlanAction: Action = {
  name: "CREATE_REFACTOR_PLAN",
  similes: ["PRIORITIZE_FIXES", "WHAT_FIX_FIRST", "MAKE_PLAN"],
  description:
    "Create a prioritized refactor plan from the most recent Misoki repo analysis in this chat.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    const hasContext = getCachedAnalysis(message.roomId) !== null || getLastRepoUrl(message.roomId) !== null;
    return hasContext && extractGithubUrl(text) === null && REFACTOR_PLAN_RE.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      let analysis = getCachedAnalysis(message.roomId);
      if (!analysis) {
        const repoUrl = getLastRepoUrl(message.roomId);
        if (repoUrl) {
          await respond(message, callback, `Re-analyzing ${repoUrl} to create a refactor plan...`, "CREATE_REFACTOR_PLAN");
          const result = await analyzeRepo(runtime, {
            githubUrl: repoUrl,
            maxFiles: getBackgroundAnalysisMaxFiles(runtime),
            includeCategories: CHAT_ANALYSIS_CATEGORIES,
          });
          cacheAnalysis(message.roomId, result);
          analysis = getCachedAnalysis(message.roomId);
        }
      }
      if (!analysis) {
        throw new Error("No repository analysis is cached for this chat yet. Send a GitHub URL first.");
      }

      const sortedIssues = sortIssues(analysis.issues);
      const summary = formatRefactorPlan(analysis, sortedIssues);
      await respond(message, callback, summary, "CREATE_REFACTOR_PLAN");

      return {
        success: true,
        text: summary,
        data: {
          repo: analysis.repo,
          commit: analysis.commit,
          summary: analysis.summary,
          topIssues: sortedIssues.slice(0, 8),
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await respond(message, callback, `Refactor plan unavailable: ${messageText}`, "CREATE_REFACTOR_PLAN");
      return {
        success: false,
        error: messageText,
      };
    }
  },
};

const applySafeFixesAction: Action = {
  name: "APPLY_SAFE_FIXES",
  similes: ["APPLY_FIXES", "APPLY_QUICK_WINS", "APPLY_CLEANUP"],
  description:
    "Apply currently supported low-risk fixes from the most recent Misoki analysis in this chat.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    const hasContext = getCachedAnalysis(message.roomId) !== null || getLastRepoUrl(message.roomId) !== null;
    return hasContext && extractGithubUrl(text) === null && APPLY_SAFE_FIXES_RE.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const analysis = getCachedAnalysis(message.roomId);
      if (!analysis) {
        throw new Error("No repository analysis is cached for this chat yet.");
      }

      const requestedCount = extractRequestedIssueCount(getMessageText(message), 5);
      const fixIds = sortIssues(analysis.issues)
        .filter((issue) => issue.fixable)
        .slice(0, requestedCount)
        .map((issue) => issue.fix_id);

      if (fixIds.length === 0) {
        const noFixesText =
          "The latest analysis result doesn't contain any supported low-risk fixes I can apply automatically. " +
          "Right now I can safely apply previewable fixes like unused-import cleanup when those findings appear. " +
          "Try a repo with fixable issues, or ask me to explain the current findings or create a refactor plan instead.";
        await respond(message, callback, noFixesText, "APPLY_SAFE_FIXES");
        return {
          success: true,
          text: noFixesText,
          data: {
            repo: analysis.repo,
            appliedCount: 0,
            skippedCount: 0,
            appliedFixIds: [],
            changedFiles: [],
            combinedDiff: "",
            note: "No supported low-risk fixes were available in the cached analysis result.",
          },
        };
      }

      const result = await applySafeFixes(runtime, {
        githubUrl: analysis.repo,
        fixIds,
      });
      cacheApplyResult(message.roomId, result);
      const summary = formatApplySummary(result);
      await respond(message, callback, summary, "APPLY_SAFE_FIXES");

      return {
        success: true,
        text: summary,
        data: {
          repo: result.repo,
          appliedCount: result.applied_count,
          skippedCount: result.skipped_count,
          appliedFixIds: result.applied_fix_ids,
          changedFiles: result.files.map((file) => file.file),
          combinedDiff: result.combined_diff,
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error({ error }, "Misoki apply-safe-fixes action failed");
      await respond(message, callback, `Apply safe fixes failed: ${messageText}`, "APPLY_SAFE_FIXES");
      return {
        success: false,
        error: messageText,
      };
    }
  },
};

const createPrAction: Action = {
  name: "CREATE_PR",
  similes: ["DRAFT_PR", "PREPARE_PR", "MAKE_PULL_REQUEST"],
  description:
    "Prepare a pull-request draft from the most recent Misoki analysis and any safe fixes already applied in this chat.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State) => {
    const text = getMessageText(message);
    const hasContext = getCachedAnalysis(message.roomId) !== null || getLastRepoUrl(message.roomId) !== null;
    return hasContext && extractGithubUrl(text) === null && CREATE_PR_RE.test(text);
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const analysis = getCachedAnalysis(message.roomId);
      if (!analysis) {
        throw new Error("No repository analysis is cached for this chat yet.");
      }

      const cachedApply = getCachedApplyResult(message.roomId);
      const draft = buildPrDraft(analysis, cachedApply?.response ?? null);
      let summary = formatPrDraftSummary({
        repo: analysis.repo,
        branchName: draft.branchName,
        title: draft.title,
        body: draft.body,
        appliedCount: draft.appliedCount,
        changedFiles: draft.changedFiles,
      });
      let createdPr:
        | {
            prUrl: string;
            prNumber: number;
            headBranch: string;
            baseBranch: string;
            targetRepo: string;
          }
        | null = null;

      if (cachedApply?.response.files.length) {
        try {
          createdPr = await createGitHubPrFromPatches(_runtime, {
            analyzedRepoUrl: analysis.repo,
            baseBranch: analysis.branch,
            branchName: draft.branchName,
            title: draft.title,
            body: draft.body,
            files: cachedApply.response.files,
          });
          summary = `${summary}\n\nDraft PR created: ${createdPr.prUrl}`;
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          logger.warn({ error }, "Misoki real GitHub PR creation failed; returning draft only");
          summary = `${summary}\n\nReal GitHub PR was not created automatically: ${messageText}`;
        }
      } else {
        summary = `${summary}\n\nApply safe fixes first if you want a real PR with an attached patch set.`;
      }
      await respond(message, callback, summary, "CREATE_PR");

      return {
        success: true,
        text: summary,
        data: {
          repo: analysis.repo,
          branchName: draft.branchName,
          title: draft.title,
          body: draft.body,
          appliedCount: draft.appliedCount,
          changedFiles: draft.changedFiles,
          combinedDiff: cachedApply?.response.combined_diff ?? "",
          prUrl: createdPr?.prUrl ?? null,
          prNumber: createdPr?.prNumber ?? null,
          targetRepo: createdPr?.targetRepo ?? null,
          note: createdPr
            ? "A draft pull request was created through the GitHub API."
            : "This prototype can prepare a PR draft and will create a real GitHub PR when a token and patch set are available.",
        },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error({ error }, "Misoki create-pr action failed");
      await respond(message, callback, `Create PR failed: ${messageText}`, "CREATE_PR");
      return {
        success: false,
        error: messageText,
      };
    }
  },
};

export const misokiPlugin: Plugin = {
  name: "misoki-plugin",
  description: "Integrates the Misoki analysis service into the Eliza project agent.",
  actions: [
    analyzeRepoAction,
    previewFixAction,
    showTopIssuesAction,
    showFileDetailsAction,
    explainFindingAction,
    createRefactorPlanAction,
    applySafeFixesAction,
    createPrAction,
  ],
};

export default misokiPlugin;
