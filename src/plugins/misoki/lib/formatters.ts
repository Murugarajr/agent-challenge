import type { ApplyFixResponse, AnalyzeRepoResponse, AnalysisIssue, PreviewFixResponse } from "./client";

function formatIssue(issue: AnalysisIssue): string {
  const line = issue.line ? `:${issue.line}` : "";
  const fixable = issue.fixable ? ` fix_id=${issue.fix_id}` : "";
  return `- [${issue.severity}] ${issue.file}${line} ${issue.title}${fixable}`;
}

export function formatAnalysisSummary(result: AnalyzeRepoResponse): string {
  const topIssues = result.issues.slice(0, 8).map(formatIssue).join("\n");
  const categories = Object.entries(result.categories)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");

  return [
    `Analyzed ${result.repo} at ${result.commit.slice(0, 7)} on branch ${result.branch}.`,
    `Scanned ${result.files_scanned} file(s). Severity summary: critical=${result.summary.critical}, warning=${result.summary.warning}, info=${result.summary.info}.`,
    categories ? `Categories: ${categories}.` : "No issues found.",
    topIssues ? `Top findings:\n${topIssues}` : "",
    result.issues.some((issue) => issue.fixable)
      ? "For previewable fixes, use the exact fix_id shown above and ask me to preview it."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPreviewSummary(result: PreviewFixResponse, fixId: string): string {
  const diffPreview = result.diff
    .split("\n")
    .slice(0, 20)
    .join("\n");

  return [
    `Preview for ${fixId} in ${result.file}${result.line ? `:${result.line}` : ""}.`,
    `Supported=${result.supported}. Risk=${result.risk}. ${result.message}`,
    result.diff ? `Diff preview:\n${diffPreview}` : "No diff available.",
  ].join("\n");
}

export function formatTopIssuesSummary(
  result: AnalyzeRepoResponse,
  issues: AnalysisIssue[],
  label: string
): string {
  const topIssues = issues.slice(0, 8).map(formatIssue).join("\n");

  return [
    `${label} for ${result.repo} at ${result.commit.slice(0, 7)}.`,
    `Showing ${Math.min(issues.length, 8)} of ${issues.length} matching finding(s).`,
    topIssues || "No matching findings.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatFileDetailsSummary(
  result: AnalyzeRepoResponse,
  filePath: string,
  issues: AnalysisIssue[]
): string {
  const categories = [...new Set(issues.map((issue) => issue.category))].join(", ");
  const topIssues = issues.slice(0, 8).map(formatIssue).join("\n");

  return [
    `Details for ${filePath} in ${result.repo} at ${result.commit.slice(0, 7)}.`,
    `${issues.length} finding(s) in this file.${categories ? ` Categories: ${categories}.` : ""}`,
    topIssues || "No findings for this file.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatFindingExplanation(issue: AnalysisIssue): string {
  const location = `${issue.file}${issue.line ? `:${issue.line}` : ""}`;
  const fixable = issue.fixable
    ? `This finding is previewable with fix_id=${issue.fix_id}.`
    : "This finding is not currently previewable as an automated fix.";

  return [
    `Finding explanation for ${location}.`,
    `${issue.title}`,
    `Category=${issue.category}. Severity=${issue.severity}. Source type=${issue.source_type}.`,
    issue.details,
    fixable,
  ].join("\n");
}

export function formatRefactorPlan(result: AnalyzeRepoResponse, issues: AnalysisIssue[]): string {
  const criticalIssues = issues.filter((issue) => issue.severity === "critical");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const topFile = getTopFileByIssueWeight(issues);

  const steps = [
    criticalIssues.length > 0
      ? `1. Start with the critical findings in ${topFile ?? "the top affected file"} to reduce the biggest architectural and performance risks first.`
      : "1. Start with the highest-signal warnings in the top affected file.",
    topFile
      ? `2. Focus the first refactor pass on ${topFile}, since it currently concentrates the most analysis findings.`
      : "2. Focus the first refactor pass on the file with the densest cluster of findings.",
    warningIssues.some((issue) => issue.category === "architecture")
      ? "3. Reduce branching and responsibility concentration before making smaller cleanup changes."
      : "3. Tackle structural issues before lower-signal cleanup work.",
    issues.some((issue) => issue.fixable)
      ? "4. Use previewable low-risk fixes after the structural changes to remove safe cleanup items."
      : "4. Finish with low-risk cleanup and follow-up validation after the structural refactor.",
  ];

  return [
    `Refactor plan for ${result.repo} at ${result.commit.slice(0, 7)}.`,
    `Based on ${issues.length} finding(s): critical=${result.summary.critical}, warning=${result.summary.warning}, info=${result.summary.info}.`,
    ...steps,
  ].join("\n");
}

function getTopFileByIssueWeight(issues: AnalysisIssue[]): string | null {
  const weights = new Map<string, number>();
  for (const issue of issues) {
    const weight = issue.severity === "critical" ? 3 : issue.severity === "warning" ? 2 : 1;
    weights.set(issue.file, (weights.get(issue.file) ?? 0) + weight);
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

export function formatApplySummary(result: ApplyFixResponse): string {
  const changedFiles = result.files.map((file) => file.file).join(", ");
  const skipped = result.skipped
    .slice(0, 5)
    .map((item) => `- ${item.fix_id}: ${item.reason}`)
    .join("\n");

  return [
    `Applied safe fixes for ${result.repo}.`,
    `Applied ${result.applied_count} fix(es) across ${result.files.length} file(s). Skipped ${result.skipped_count}.`,
    changedFiles ? `Changed files: ${changedFiles}.` : "No files were changed.",
    result.applied_fix_ids.length > 0 ? `Applied fix_ids: ${result.applied_fix_ids.join(", ")}` : "",
    skipped ? `Skipped fixes:\n${skipped}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPrDraftSummary(input: {
  repo: string;
  branchName: string;
  title: string;
  body: string;
  appliedCount: number;
  changedFiles: string[];
}): string {
  const bodyPreview = input.body.split("\n").slice(0, 12).join("\n");

  return [
    `Prepared PR draft for ${input.repo}.`,
    `Branch suggestion: ${input.branchName}`,
    `Title: ${input.title}`,
    input.changedFiles.length > 0 ? `Files: ${input.changedFiles.join(", ")}` : "No file patch set is attached yet.",
    `Applied safe fixes included: ${input.appliedCount}.`,
    `Body preview:\n${bodyPreview}`,
  ].join("\n");
}
