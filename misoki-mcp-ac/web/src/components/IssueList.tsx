"use client";

import { useState } from "react";
import type { AnalysisIssue, RepoAnalyzeResponse } from "@/lib/types";

type Props = {
    analysis: RepoAnalyzeResponse;
    selectedFile: string | null;
    onPreviewFix: (issue: AnalysisIssue) => void;
};

function SeverityBadge({ severity }: { severity: string }) {
    return <span className={`badge badge-${severity}`}>{severity}</span>;
}

export default function IssueList({ analysis, selectedFile, onPreviewFix }: Props) {
    const [search, setSearch] = useState("");
    const [severityFilter, setSeverityFilter] = useState<string>("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");

    const categories = [...new Set(analysis.issues.map((i) => i.category))].sort();

    const filtered = analysis.issues.filter((issue) => {
        if (selectedFile && issue.file !== selectedFile) return false;
        if (severityFilter !== "all" && issue.severity !== severityFilter) return false;
        if (categoryFilter !== "all" && issue.category !== categoryFilter) return false;
        if (search.trim()) {
            const q = search.toLowerCase();
            return (
                issue.title.toLowerCase().includes(q) ||
                issue.file.toLowerCase().includes(q) ||
                issue.details.toLowerCase().includes(q) ||
                issue.category.toLowerCase().includes(q)
            );
        }
        return true;
    });

    // Sort: critical first, then by file+line
    const sorted = [...filtered].sort((a, b) => {
        const sev = (s: string) => (s === "critical" ? 3 : s === "warning" ? 2 : 1);
        return sev(b.severity) - sev(a.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0);
    });

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Toolbar */}
            <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
            }}>
                <div style={{ position: "relative", flex: "1 1 180px" }}>
                    <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                        className="input"
                        style={{ paddingLeft: 32, fontSize: "0.85rem" }}
                        placeholder="Search issues…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <select
                    className="input"
                    style={{ width: "auto", flex: "0 0 auto", fontSize: "0.82rem", cursor: "pointer" }}
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                >
                    <option value="all">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                </select>
                <select
                    className="input"
                    style={{ width: "auto", flex: "0 0 auto", fontSize: "0.82rem", cursor: "pointer" }}
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                >
                    <option value="all">All categories</option>
                    {categories.map((c) => (
                        <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                    ))}
                </select>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {sorted.length} / {analysis.issues.length}
                </span>
            </div>

            {/* Issue rows */}
            <div style={{ flex: 1, overflowY: "auto" }}>
                {sorted.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                        <div style={{ fontSize: "2rem", marginBottom: 8 }}>✨</div>
                        <p style={{ fontSize: "0.9rem" }}>No issues match your filters</p>
                    </div>
                ) : (
                    sorted.map((issue, idx) => (
                        <IssueRow key={`${issue.fix_id}-${idx}`} issue={issue} onPreviewFix={onPreviewFix} />
                    ))
                )}
            </div>
        </div>
    );
}

function IssueRow({ issue, onPreviewFix }: { issue: AnalysisIssue; onPreviewFix: (i: AnalysisIssue) => void }) {
    const [expanded, setExpanded] = useState(false);
    const parts = issue.file.split("/");
    const basename = parts[parts.length - 1];
    const dir = parts.slice(0, -1).join("/");

    return (
        <div
            style={{
                borderBottom: "1px solid var(--border)",
                padding: "12px 16px",
                transition: "background 0.15s",
                cursor: "pointer",
            }}
            onClick={() => setExpanded((p) => !p)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-1)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <SeverityBadge severity={issue.severity} />
                <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {dir ? `${dir}/` : ""}
                    <strong style={{ color: "var(--text-primary)" }}>{basename}</strong>
                    {issue.line != null && <span style={{ color: "var(--text-muted)" }}>:{issue.line}</span>}
                </span>
                <span style={{
                    marginLeft: "auto",
                    fontSize: "0.7rem",
                    padding: "2px 8px",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 99,
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                }}>
                    {issue.category.replace(/_/g, " ")}
                </span>
                {issue.fixable && (
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => { e.stopPropagation(); onPreviewFix(issue); }}
                        style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        Preview fix
                    </button>
                )}
                <svg
                    style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none", flexShrink: 0 }}
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </div>

            <p style={{ marginTop: 6, fontSize: "0.88rem", fontWeight: 500, color: "var(--text-primary)" }}>
                {issue.title}
            </p>

            {expanded && (
                <div className="anim-fade-in" style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.6, paddingLeft: 2 }}>
                    {issue.details}
                    {issue.fixable && (
                        <div style={{ marginTop: 8 }}>
                            <span style={{ fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)" }}>
                                fix_id: {issue.fix_id}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
