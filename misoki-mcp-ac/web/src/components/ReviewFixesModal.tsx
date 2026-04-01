"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalysisIssue, ApplyFixResponse, BatchPreviewItem } from "@/lib/types";
import { applySafeFixes, previewBatchFixes } from "@/lib/api";

type Props = {
    repoUrl: string;
    branch?: string;
    fixableIssues: AnalysisIssue[];
    onClose: () => void;
    onPatched: (result: ApplyFixResponse) => void;
};

type PreviewMap = Record<string, BatchPreviewItem>;

// ── helpers ──────────────────────────────────────────────────────────────────

function riskColor(risk: string) {
    if (risk === "low") return "#22c55e";
    if (risk === "medium") return "#f59e0b";
    return "var(--text-muted)";
}

function DiffBlock({ diff }: { diff: string }) {
    if (!diff.trim()) return (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic", margin: "6px 0 0" }}>
            No diff available.
        </p>
    );
    return (
        <pre style={{
            marginTop: 8, padding: "10px 12px",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: "0.72rem",
            color: "var(--text-secondary)",
            overflowX: "auto",
            whiteSpace: "pre",
            maxHeight: 240,
            overflowY: "auto",
        }}>
            {diff.split("\n").map((line, i) => {
                const color =
                    line.startsWith("+++") || line.startsWith("---") ? "var(--text-muted)" :
                    line.startsWith("+") ? "#4ade80" :
                    line.startsWith("-") ? "#f87171" :
                    line.startsWith("@@") ? "var(--accent-cyan)" :
                    "var(--text-secondary)";
                return <span key={i} style={{ display: "block", color }}>{line}</span>;
            })}
        </pre>
    );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ReviewFixesModal({
    repoUrl,
    branch,
    fixableIssues,
    onClose,
    onPatched,
}: Props) {
    // Per-fix selection set (fix_id → checked)
    const [selected, setSelected] = useState<Set<string>>(
        () => new Set(fixableIssues.map((i) => i.fix_id))
    );
    // Which fix cards have their diff expanded
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    // Batch preview state
    const [previews, setPreviews] = useState<PreviewMap>({});
    const [loadingPreviews, setLoadingPreviews] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    // Apply state
    const [applying, setApplying] = useState(false);
    const [applyError, setApplyError] = useState<string | null>(null);

    // Group issues by file
    const byFile = useMemo(() => {
        const map = new Map<string, AnalysisIssue[]>();
        for (const issue of fixableIssues) {
            const list = map.get(issue.file) ?? [];
            list.push(issue);
            map.set(issue.file, list);
        }
        return map;
    }, [fixableIssues]);

    const selectedCount = selected.size;
    const allSelected = selectedCount === fixableIssues.length;
    const noneSelected = selectedCount === 0;

    // Load batch previews on mount
    useEffect(() => {
        if (fixableIssues.length === 0) return;
        setLoadingPreviews(true);
        setPreviewError(null);
        previewBatchFixes(repoUrl, fixableIssues.map((i) => i.fix_id), branch)
            .then((res) => {
                const map: PreviewMap = {};
                for (const p of res.previews) map[p.fix_id] = p;
                setPreviews(map);
            })
            .catch((err) => {
                setPreviewError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setLoadingPreviews(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    function toggleFix(fixId: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(fixId) ? next.delete(fixId) : next.add(fixId);
            return next;
        });
    }

    function toggleFile(file: string, issues: AnalysisIssue[]) {
        const allChecked = issues.every((i) => selected.has(i.fix_id));
        setSelected((prev) => {
            const next = new Set(prev);
            issues.forEach((i) => allChecked ? next.delete(i.fix_id) : next.add(i.fix_id));
            return next;
        });
    }

    function toggleExpanded(fixId: string) {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(fixId) ? next.delete(fixId) : next.add(fixId);
            return next;
        });
    }

    async function handleApply() {
        if (noneSelected) return;
        setApplying(true);
        setApplyError(null);
        try {
            const result = await applySafeFixes(repoUrl, Array.from(selected), branch);
            onPatched(result);
        } catch (err) {
            setApplyError(err instanceof Error ? err.message : String(err));
            setApplying(false);
        }
    }

    return (
        <div
            style={{
                position: "fixed", inset: 0, zIndex: 200,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: "min(860px, 96vw)",
                    maxHeight: "88vh",
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-bright)",
                    borderRadius: 14,
                    display: "flex", flexDirection: "column",
                    overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ── */}
                <div style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--surface-1)",
                    display: "flex", alignItems: "center", gap: 12,
                }}>
                    <span style={{ fontSize: "1.1rem" }}>🔍</span>
                    <div style={{ flex: 1 }}>
                        <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Review Safe Patches</p>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                            {fixableIssues.length} fixable issue{fixableIssues.length !== 1 ? "s" : ""} found
                            {loadingPreviews && " · Loading diffs…"}
                            {!loadingPreviews && Object.keys(previews).length > 0 && ` · ${Object.keys(previews).length} diffs loaded`}
                        </p>
                    </div>
                    {/* Select / Deselect all */}
                    <button
                        onClick={() =>
                            setSelected(allSelected
                                ? new Set()
                                : new Set(fixableIssues.map((i) => i.fix_id))
                            )
                        }
                        style={{
                            background: "var(--surface-2)", border: "1px solid var(--border)",
                            borderRadius: 6, color: "var(--text-secondary)",
                            cursor: "pointer", padding: "5px 10px", fontSize: "0.75rem",
                        }}
                    >
                        {allSelected ? "Deselect all" : "Select all"}
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            background: "var(--surface-2)", border: "1px solid var(--border)",
                            borderRadius: 6, color: "var(--text-secondary)",
                            cursor: "pointer", padding: "5px 12px", fontSize: "0.8rem",
                        }}
                    >
                        Cancel
                    </button>
                </div>

                {/* ── Preview load error ── */}
                {previewError && (
                    <div style={{ padding: "8px 20px", background: "rgba(239,68,68,0.08)", borderBottom: "1px solid var(--border)", fontSize: "0.78rem", color: "#f87171" }}>
                        ⚠ Could not load diffs: {previewError}. Fixes can still be selected.
                    </div>
                )}

                {/* ── Fix list ── */}
                <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
                    {Array.from(byFile.entries()).map(([file, issues]) => {
                        const fileAllChecked = issues.every((i) => selected.has(i.fix_id));
                        const fileSomeChecked = issues.some((i) => selected.has(i.fix_id));

                        return (
                            <div key={file} style={{ marginBottom: 18 }}>
                                {/* File header */}
                                <div style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "6px 0", borderBottom: "1px solid var(--border)",
                                    marginBottom: 6,
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={fileAllChecked}
                                        ref={(el) => {
                                            if (el) el.indeterminate = !fileAllChecked && fileSomeChecked;
                                        }}
                                        onChange={() => toggleFile(file, issues)}
                                        style={{ accentColor: "var(--accent-purple)", cursor: "pointer" }}
                                    />
                                    <span className="mono" style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                        {file}
                                    </span>
                                    <span style={{
                                        marginLeft: "auto", fontSize: "0.7rem",
                                        color: "var(--text-muted)",
                                        background: "var(--surface-2)",
                                        padding: "2px 8px", borderRadius: 99,
                                        border: "1px solid var(--border)",
                                    }}>
                                        {issues.filter((i) => selected.has(i.fix_id)).length} / {issues.length} selected
                                    </span>
                                </div>

                                {/* Individual fixes */}
                                {issues.map((issue) => {
                                    const preview = previews[issue.fix_id];
                                    const isExpanded = expanded.has(issue.fix_id);
                                    const isChecked = selected.has(issue.fix_id);
                                    const isUnsupported = preview && !preview.supported;
                                    const hasDiff = preview?.diff && preview.diff.trim().length > 0;

                                    return (
                                        <div
                                            key={issue.fix_id}
                                            style={{
                                                padding: "8px 10px",
                                                marginBottom: 4,
                                                background: isChecked ? "rgba(139,92,246,0.06)" : "var(--surface-1)",
                                                border: `1px solid ${isChecked ? "rgba(139,92,246,0.2)" : "var(--border)"}`,
                                                borderRadius: 8,
                                                opacity: isUnsupported ? 0.55 : 1,
                                                transition: "background 0.15s, border-color 0.15s",
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    disabled={!!isUnsupported}
                                                    onChange={() => toggleFix(issue.fix_id)}
                                                    style={{
                                                        marginTop: 2, flexShrink: 0,
                                                        accentColor: "var(--accent-purple)",
                                                        cursor: isUnsupported ? "not-allowed" : "pointer",
                                                    }}
                                                />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    {/* Row 1: location + badges */}
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                        <span className="mono" style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                                            line {issue.line ?? "?"}
                                                        </span>
                                                        <span style={{
                                                            fontSize: "0.68rem", padding: "1px 7px",
                                                            borderRadius: 99, background: "var(--surface-3)",
                                                            border: "1px solid var(--border)",
                                                            color: "var(--text-muted)",
                                                        }}>
                                                            {issue.source_type}
                                                        </span>
                                                        {preview && (
                                                            <span style={{
                                                                fontSize: "0.68rem", padding: "1px 7px",
                                                                borderRadius: 99,
                                                                color: riskColor(preview.risk),
                                                                background: "var(--surface-3)",
                                                                border: `1px solid ${riskColor(preview.risk)}44`,
                                                            }}>
                                                                {preview.risk} risk
                                                            </span>
                                                        )}
                                                        {isUnsupported && (
                                                            <span style={{ fontSize: "0.68rem", color: "#f87171" }}>
                                                                ⚠ unsupported — will be skipped
                                                            </span>
                                                        )}
                                                        {preview?.error && (
                                                            <span style={{ fontSize: "0.68rem", color: "#f87171" }}>
                                                                preview failed
                                                            </span>
                                                        )}
                                                        {loadingPreviews && !preview && (
                                                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                                                                loading…
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Row 2: issue title */}
                                                    <p style={{
                                                        fontSize: "0.8rem", color: "var(--text-primary)",
                                                        margin: "3px 0 0", fontWeight: 500,
                                                    }}>
                                                        {issue.title}
                                                    </p>
                                                </div>
                                                {/* Diff toggle */}
                                                {hasDiff && (
                                                    <button
                                                        onClick={() => toggleExpanded(issue.fix_id)}
                                                        style={{
                                                            flexShrink: 0, background: "none",
                                                            border: "1px solid var(--border)",
                                                            borderRadius: 5, padding: "3px 8px",
                                                            cursor: "pointer", fontSize: "0.72rem",
                                                            color: "var(--accent-cyan)",
                                                        }}
                                                    >
                                                        {isExpanded ? "Hide diff" : "Show diff"}
                                                    </button>
                                                )}
                                            </div>

                                            {/* Inline diff */}
                                            {isExpanded && preview && (
                                                <DiffBlock diff={preview.diff} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                {/* ── Footer ── */}
                <div style={{
                    padding: "12px 20px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface-1)",
                    display: "flex", alignItems: "center", gap: 12,
                }}>
                    <div style={{ flex: 1, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        {noneSelected
                            ? "No fixes selected"
                            : <><strong style={{ color: "var(--text-primary)" }}>{selectedCount}</strong> fix{selectedCount !== 1 ? "es" : ""} selected — patches will be generated in-memory, nothing is pushed to GitHub</>
                        }
                    </div>
                    {applyError && (
                        <span style={{ fontSize: "0.75rem", color: "#f87171" }}>
                            {applyError}
                        </span>
                    )}
                    <button
                        onClick={handleApply}
                        disabled={noneSelected || applying}
                        style={{
                            background: noneSelected || applying
                                ? "var(--surface-3)"
                                : "linear-gradient(135deg, #7c3aed, #9333ea)",
                            color: noneSelected || applying ? "var(--text-muted)" : "#fff",
                            border: "none", borderRadius: 8,
                            cursor: noneSelected || applying ? "not-allowed" : "pointer",
                            padding: "8px 20px", fontSize: "0.85rem", fontWeight: 600,
                            display: "flex", alignItems: "center", gap: 6,
                            transition: "background 0.2s",
                        }}
                    >
                        {applying ? (
                            <>
                                <span style={{
                                    width: 13, height: 13, borderRadius: "50%",
                                    border: "2px solid rgba(255,255,255,0.3)",
                                    borderTopColor: "#fff",
                                    animation: "spin 0.7s linear infinite",
                                    display: "inline-block",
                                }} />
                                Generating…
                            </>
                        ) : (
                            <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                Generate Patches ({selectedCount})
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
