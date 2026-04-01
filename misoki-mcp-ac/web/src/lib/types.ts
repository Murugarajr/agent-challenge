export type SeveritySummary = {
    critical: number;
    warning: number;
    info: number;
};

export type AnalysisIssue = {
    file: string;
    category: string;
    severity: "critical" | "warning" | "info";
    title: string;
    details: string;
    line?: number | null;
    fixable: boolean;
    fix_id: string;
    source_type: string;
};

export type RepoAnalyzeResponse = {
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

export type AppliedFixResult = {
    fix_id: string;
    file: string;
    line: number;
    source_type: string;
    applied: boolean;
    risk: string;
    message: string;
};

export type AppliedFilePatch = {
    file: string;
    applied_fix_ids: string[];
    original: string;
    modified: string;
    diff: string;
};

export type BatchPreviewItem = {
    fix_id: string;
    file: string;
    line?: number | null;
    source_type: string;
    risk: string;
    supported: boolean;
    message: string;
    diff: string;
    error?: string | null;
};

export type BatchPreviewResponse = {
    repo: string;
    branch?: string | null;
    previews: BatchPreviewItem[];
};

export type ApplyFixResponse = {
    repo: string;
    branch: string;
    applied_count: number;
    skipped_count: number;
    applied_fix_ids: string[];
    applied: AppliedFixResult[];
    skipped: { fix_id: string; reason: string }[];
    files: AppliedFilePatch[];
    combined_diff: string;
};
