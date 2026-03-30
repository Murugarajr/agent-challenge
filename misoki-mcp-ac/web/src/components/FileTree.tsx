"use client";

import type { AnalysisIssue, RepoAnalyzeResponse } from "@/lib/types";

function severityWeight(s: string) {
    if (s === "critical") return 3;
    if (s === "warning") return 2;
    return 1;
}

function getFileWeight(file: string, issues: AnalysisIssue[]) {
    return issues
        .filter((i) => i.file === file)
        .reduce((sum, i) => sum + severityWeight(i.severity), 0);
}

type Props = {
    analysis: RepoAnalyzeResponse;
    selectedFile: string | null;
    onSelectFile: (file: string | null) => void;
};

export default function FileTree({ analysis, selectedFile, onSelectFile }: Props) {
    const files = [...new Set(analysis.issues.map((i) => i.file))].sort(
        (a, b) => getFileWeight(b, analysis.issues) - getFileWeight(a, analysis.issues)
    );

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
                <h3 style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Affected Files
                </h3>
                {selectedFile && (
                    <button
                        onClick={() => onSelectFile(null)}
                        style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem" }}
                    >
                        Clear
                    </button>
                )}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {files.map((file) => {
                    const fileIssues = analysis.issues.filter((i) => i.file === file);
                    const critCount = fileIssues.filter((i) => i.severity === "critical").length;
                    const warnCount = fileIssues.filter((i) => i.severity === "warning").length;
                    const isSelected = selectedFile === file;
                    const parts = file.split("/");
                    const basename = parts[parts.length - 1];
                    const dir = parts.slice(0, -1).join("/");

                    return (
                        <button
                            key={file}
                            onClick={() => onSelectFile(isSelected ? null : file)}
                            style={{
                                width: "100%",
                                background: isSelected ? "var(--surface-2)" : "transparent",
                                border: "none",
                                borderLeft: isSelected ? "2px solid var(--accent-purple)" : "2px solid transparent",
                                cursor: "pointer",
                                padding: "8px 14px",
                                textAlign: "left",
                                transition: "background 0.15s",
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                            }}
                        >
                            <span style={{ fontSize: "0.82rem", color: isSelected ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isSelected ? 600 : 400, fontFamily: "'JetBrains Mono', monospace" }}>
                                {basename}
                            </span>
                            {dir && (
                                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                                    {dir}/
                                </span>
                            )}
                            <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                                {critCount > 0 && (
                                    <span style={{ fontSize: "0.7rem", color: "var(--severity-critical)", background: "var(--severity-critical-bg)", padding: "1px 6px", borderRadius: 99, fontWeight: 600 }}>
                                        {critCount} crit
                                    </span>
                                )}
                                {warnCount > 0 && (
                                    <span style={{ fontSize: "0.7rem", color: "var(--severity-warning)", background: "var(--severity-warning-bg)", padding: "1px 6px", borderRadius: 99, fontWeight: 600 }}>
                                        {warnCount} warn
                                    </span>
                                )}
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "auto" }}>
                                    {fileIssues.length}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
