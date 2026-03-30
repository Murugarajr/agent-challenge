"use client";

import type { RepoAnalyzeResponse, SeveritySummary } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

function AnimatedNumber({ target }: { target: number }) {
    const [display, setDisplay] = useState(0);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const start = performance.now();
        const duration = 800;
        function step(now: number) {
            const t = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3);
            setDisplay(Math.round(ease * target));
            if (t < 1) rafRef.current = requestAnimationFrame(step);
        }
        rafRef.current = requestAnimationFrame(step);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [target]);

    return <>{display}</>;
}

const CARDS = [
    {
        key: "critical" as const,
        label: "Critical",
        color: "var(--severity-critical)",
        bg: "var(--severity-critical-bg)",
        border: "rgba(239,68,68,0.3)",
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.8" fill="currentColor" />
            </svg>
        ),
    },
    {
        key: "warning" as const,
        label: "Warnings",
        color: "var(--severity-warning)",
        bg: "var(--severity-warning-bg)",
        border: "rgba(245,158,11,0.3)",
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="17" r="0.8" fill="currentColor" />
            </svg>
        ),
    },
    {
        key: "info" as const,
        label: "Info",
        color: "var(--severity-info)",
        bg: "var(--severity-info-bg)",
        border: "rgba(59,130,246,0.3)",
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><circle cx="12" cy="8" r="0.8" fill="currentColor" />
            </svg>
        ),
    },
];

type Props = { summary: SeveritySummary; analysis: RepoAnalyzeResponse };

export default function SeverityCards({ summary, analysis }: Props) {
    return (
        <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
                {CARDS.map(({ key, label, color, bg, border, icon }) => (
                    <div
                        key={key}
                        className="anim-fade-up"
                        style={{
                            background: bg,
                            border: `1px solid ${border}`,
                            borderRadius: 12,
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 8,
                        }}
                    >
                        <span style={{ color, flexShrink: 0 }}>{icon}</span>
                        <div>
                            <p style={{ fontSize: "1.6rem", fontWeight: 800, color, lineHeight: 1, letterSpacing: "-0.03em" }}>
                                <AnimatedNumber target={summary[key]} />
                            </p>
                            <p style={{ fontSize: "0.78rem", color, opacity: 0.8, fontWeight: 600, marginTop: 4 }}>{label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Metadata row */}
            <div style={{
                display: "flex", flexWrap: "wrap", gap: 16,
                padding: "12px 14px",
                background: "var(--surface-1)",
                borderRadius: 8,
                border: "1px solid var(--border)",
                fontSize: "0.78rem",
                color: "var(--text-secondary)",
            }}>
                <span>📁 <strong style={{ color: "var(--text-primary)" }}>{analysis.files_scanned}</strong> files scanned</span>
                {analysis.skipped_files > 0 && (
                    <span>⏭ <strong style={{ color: "var(--text-primary)" }}>{analysis.skipped_files}</strong> skipped</span>
                )}
                <span className="mono" style={{ marginLeft: "auto" }}>
                    {analysis.commit.slice(0, 7)} · {analysis.branch}
                </span>
            </div>
        </div>
    );
}
