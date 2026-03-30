"use client";

import type { RepoAnalyzeResponse } from "@/lib/types";

const CATEGORY_COLORS: Record<string, string> = {
    architecture: "#a855f7",
    dead_code: "#ef4444",
    duplication: "#f97316",
    performance: "#eab308",
    type_hints: "#3b82f6",
    code_quality: "#10b981",
};

type Props = { analysis: RepoAnalyzeResponse };

export default function CategoryBreakdown({ analysis }: Props) {
    const entries = Object.entries(analysis.categories).sort((a, b) => b[1] - a[1]);
    const maxCount = Math.max(...entries.map(([, c]) => c), 1);

    if (entries.length === 0) return null;

    return (
        <div>
            <h3 style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
                By Category
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {entries.map(([cat, count]) => {
                    const color = CATEGORY_COLORS[cat] ?? "var(--accent-cyan)";
                    const pct = (count / maxCount) * 100;
                    const label = cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                    return (
                        <div key={cat}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
                                    {label}
                                </span>
                                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>{count}</span>
                            </div>
                            <div style={{ height: 5, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
                                <div style={{
                                    height: "100%",
                                    width: `${pct}%`,
                                    background: color,
                                    borderRadius: 99,
                                    transition: "width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
