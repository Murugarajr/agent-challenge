"use client";

import dynamic from "next/dynamic";
import type { PreviewFixResponse } from "@/lib/types";

const DiffEditor = dynamic(
    () => import("@monaco-editor/react").then((m) => m.DiffEditor),
    { ssr: false, loading: () => <div className="skeleton" style={{ height: 400, borderRadius: 8 }} /> }
);

type Props = {
    preview: PreviewFixResponse;
    fixId: string;
    loading: boolean;
    onClose: () => void;
};

const RISK_COLORS: Record<string, string> = {
    low: "var(--severity-info)",
    medium: "var(--severity-warning)",
    high: "var(--severity-critical)",
};

export default function DiffViewer({ preview, fixId, loading, onClose }: Props) {
    return (
        <div
            className="anim-fade-in"
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 200,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                background: "rgba(0,0,0,0.7)",
                backdropFilter: "blur(4px)",
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 1100,
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-bright)",
                    borderRadius: "18px 18px 0 0",
                    overflow: "hidden",
                    maxHeight: "82vh",
                    display: "flex",
                    flexDirection: "column",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex", alignItems: "center", gap: 14,
                    background: "var(--surface-1)",
                }}>
                    <span style={{ fontSize: "1.2rem" }}>🔧</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {preview.file}
                            {preview.line != null && <span style={{ color: "var(--text-muted)" }}>:{preview.line}</span>}
                        </p>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                            {fixId}
                        </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {!loading && (
                            <>
                                <span style={{
                                    padding: "3px 10px",
                                    background: `${RISK_COLORS[preview.risk] ?? "var(--text-muted)"}22`,
                                    border: `1px solid ${RISK_COLORS[preview.risk] ?? "var(--text-muted)"}55`,
                                    borderRadius: 99,
                                    fontSize: "0.72rem",
                                    fontWeight: 700,
                                    color: RISK_COLORS[preview.risk] ?? "var(--text-muted)",
                                    textTransform: "uppercase",
                                }}>
                                    {preview.risk} risk
                                </span>
                                {!preview.supported && (
                                    <span style={{ fontSize: "0.78rem", color: "var(--severity-warning)" }}>
                                        ⚠ Preview not supported for this fix type
                                    </span>
                                )}
                            </>
                        )}
                        <button
                            onClick={onClose}
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                color: "var(--text-secondary)",
                                cursor: "pointer",
                                padding: "5px 12px",
                                fontSize: "0.8rem",
                                display: "flex", alignItems: "center", gap: 5,
                            }}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Close
                        </button>
                    </div>
                </div>

                {/* Message */}
                {!loading && preview.message && (
                    <div style={{ padding: "8px 20px", background: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
                        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{preview.message}</p>
                    </div>
                )}

                {/* Monaco diff */}
                <div style={{ flex: 1, minHeight: 0 }}>
                    {loading ? (
                        <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: "50%",
                                border: "3px solid var(--surface-3)",
                                borderTopColor: "var(--accent-purple)",
                                animation: "spin 0.8s linear infinite",
                            }} />
                            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Generating diff preview…</p>
                        </div>
                    ) : (
                        <DiffEditor
                            height="min(500px, 60vh)"
                            language="python"
                            original={preview.original}
                            modified={preview.modified}
                            theme="vs-dark"
                            options={{
                                readOnly: true,
                                renderSideBySide: true,
                                fontSize: 13,
                                lineNumbers: "on",
                                scrollBeyondLastLine: false,
                                minimap: { enabled: false },
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
