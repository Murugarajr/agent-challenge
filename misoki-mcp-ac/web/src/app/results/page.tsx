"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisIssue, ApplyFixResponse, PreviewFixResponse, RepoAnalyzeResponse } from "@/lib/types";
import { previewFix } from "@/lib/api";

import SeverityCards from "@/components/SeverityCards";
import CategoryBreakdown from "@/components/CategoryBreakdown";
import FileTree from "@/components/FileTree";
import IssueList from "@/components/IssueList";
import DiffViewer from "@/components/DiffViewer";
import ChatPanel, { ChatPanelRef } from "@/components/ChatPanel";
import ReviewFixesModal from "@/components/ReviewFixesModal";

export default function ResultsPage() {
    const router = useRouter();
    const [analysis, setAnalysis] = useState<RepoAnalyzeResponse | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [previewState, setPreviewState] = useState<{
        issue: AnalysisIssue;
        preview: PreviewFixResponse | null;
        loading: boolean;
    } | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [applyState, setApplyState] = useState<{
        result: ApplyFixResponse | null;
    }>({ result: null });

    useEffect(() => {
        const raw = sessionStorage.getItem("misoki_analysis");
        if (!raw) {
            router.replace("/");
            return;
        }
        try {
            setAnalysis(JSON.parse(raw) as RepoAnalyzeResponse);
        } catch {
            router.replace("/");
        }
    }, [router]);

    const fixableIssues = analysis?.issues.filter((i) => i.fixable) ?? [];
    const chatRef = useRef<ChatPanelRef>(null);
    const [chatInitialPrompt, setChatInitialPrompt] = useState<string | null>(null);

    function draftPRToAgent() {
        if (!applyState.result?.combined_diff) return;
        let diff = applyState.result.combined_diff;
        
        // Truncate the diff if it's too large to prevent agent context window errors (e.g., Qwen3.5 has 20k token limit)
        const MAX_DIFF_LENGTH = 12000;
        if (diff.length > MAX_DIFF_LENGTH) {
            diff = diff.substring(0, MAX_DIFF_LENGTH) + '\n\n...[Diff truncated due to context limits]';
        }
        
        const prompt = `Create PR\n\nPlease draft a Pull Request for these safe fixes:\n\n\`\`\`diff\n${diff}\n\`\`\``;
        
        setApplyState(s => ({ ...s, result: null }));
        
        if (chatOpen) {
            chatRef.current?.sendExternalMessage(prompt);
        } else {
            setChatInitialPrompt(prompt);
            setChatOpen(true);
        }
    }

    function handlePatched(result: ApplyFixResponse) {
        setReviewOpen(false);
        setApplyState({ result });
    }

    async function handlePreviewFix(issue: AnalysisIssue) {
        if (!analysis) return;
        setPreviewState({ issue, preview: null, loading: true });
        try {
            const preview = await previewFix(analysis.repo, issue.fix_id, analysis.branch);
            setPreviewState({ issue, preview, loading: false });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setPreviewState({
                issue,
                loading: false,
                preview: {
                    file: issue.file,
                    line: issue.line,
                    source_type: issue.source_type,
                    risk: "unknown",
                    supported: false,
                    message: `Preview failed: ${msg}`,
                    original: "",
                    modified: "",
                    diff: "",
                },
            });
        }
    }

    if (!analysis) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "calc(100vh - 56px)" }}>
                <div style={{ textAlign: "center" }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: "50%",
                        border: "3px solid var(--surface-3)",
                        borderTopColor: "var(--accent-purple)",
                        animation: "spin 0.8s linear infinite",
                        margin: "0 auto 16px",
                    }} />
                    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading analysis…</p>
                </div>
            </div>
        );
    }

    const repoName = analysis.repo.split("/").slice(-2).join("/");

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", overflow: "hidden" }}>

            {/* ── Top status bar ── */}
            <div style={{
                padding: "10px 20px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-raised)",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
                <button
                    onClick={() => router.push("/")}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.82rem", padding: 0 }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    New analysis
                </button>
                <span style={{ color: "var(--border)", fontSize: "1rem" }}>|</span>
                <a href={analysis.repo} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                    </svg>
                    {repoName}
                </a>
                <span className="mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {analysis.commit.slice(0, 7)}
                </span>
                <span className="mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {analysis.branch}
                </span>
                <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {analysis.issues.length} issues · {analysis.files_scanned} files
                </span>

                {/* Review & generate patches */}
                {fixableIssues.length > 0 && (
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setReviewOpen(true)}
                        style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        Review Patches ({fixableIssues.length})
                    </button>
                )}
                {applyState.result && (
                    <span style={{ fontSize: "0.78rem", color: "#22c55e", display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {applyState.result.applied_count} patch{applyState.result.applied_count !== 1 ? "es" : ""} generated
                        {applyState.result.skipped_count > 0 && `, ${applyState.result.skipped_count} skipped`}
                    </span>
                )}

                {/* Chat toggle */}
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setChatOpen((o) => !o)}
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {chatOpen ? "Hide Chat" : "Ask Agent"}
                </button>
            </div>

            {/* ── Main 3-column layout ── */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

                {/* ── Left sidebar: File tree + Category breakdown ── */}
                <aside style={{
                    width: 340,
                    flexShrink: 0,
                    borderRight: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}>
                    <div style={{ flex: "0 0 auto", borderBottom: "1px solid var(--border)", padding: "14px 14px 10px" }}>
                        <SeverityCards summary={analysis.summary} analysis={analysis} />
                    </div>
                    <div style={{ flex: "0 0 auto", padding: "14px 14px 10px", borderBottom: "1px solid var(--border)" }}>
                        <CategoryBreakdown analysis={analysis} />
                    </div>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                        <FileTree analysis={analysis} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
                    </div>
                </aside>

                {/* ── Center: Issue list ── */}
                <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                    {selectedFile && (
                        <div style={{
                            padding: "8px 16px",
                            background: "rgba(139,92,246,0.08)",
                            borderBottom: "1px solid rgba(139,92,246,0.2)",
                            fontSize: "0.82rem",
                            display: "flex", alignItems: "center", gap: 8,
                        }}>
                            <span style={{ color: "var(--text-muted)" }}>Filtered:</span>
                            <span className="mono" style={{ color: "var(--accent-purple)" }}>{selectedFile}</span>
                        </div>
                    )}
                    <IssueList
                        analysis={analysis}
                        selectedFile={selectedFile}
                        onPreviewFix={handlePreviewFix}
                    />
                </main>

                {/* ── Right sidebar: Chat panel ── */}
                {chatOpen && (
                    <aside
                        className="anim-fade-in"
                        style={{
                            width: 320,
                            flexShrink: 0,
                            borderLeft: "1px solid var(--border)",
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                        }}
                    >
                        <ChatPanel ref={chatRef} repoUrl={analysis.repo} initialPrompt={chatInitialPrompt} />
                    </aside>
                )}
            </div>

            {/* ── Review fixes modal ── */}
            {reviewOpen && analysis && (
                <ReviewFixesModal
                    repoUrl={analysis.repo}
                    branch={analysis.branch}
                    fixableIssues={fixableIssues}
                    onClose={() => setReviewOpen(false)}
                    onPatched={handlePatched}
                />
            )}

            {/* ── Patches generated overlay ── */}
            {applyState.result && applyState.result.files.length > 0 && (
                <div
                    className="anim-fade-in"
                    style={{
                        position: "fixed", inset: 0, zIndex: 200,
                        display: "flex", alignItems: "flex-end", justifyContent: "center",
                        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
                    }}
                    onClick={() => setApplyState((s) => ({ ...s, result: null }))}
                >
                    <div
                        style={{
                            width: "100%", maxWidth: 900,
                            background: "var(--bg-raised)",
                            border: "1px solid var(--border-bright)",
                            borderRadius: "18px 18px 0 0",
                            overflow: "hidden", maxHeight: "70vh",
                            display: "flex", flexDirection: "column",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, background: "var(--surface-1)" }}>
                            <span style={{ fontSize: "1.2rem" }}>✅</span>
                            <div style={{ flex: 1 }}>
                            <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Patches Generated</p>
                                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                    {applyState.result.applied_count} patch{applyState.result.applied_count !== 1 ? "es" : ""} · {applyState.result.skipped_count} skipped · {applyState.result.files.length} file(s) · nothing pushed to GitHub
                                </p>
                            </div>
                            {applyState.result.combined_diff && (
                                <button
                                    onClick={draftPRToAgent}
                                    style={{
                                        background: "linear-gradient(135deg, #e65c00, #ff8d00)", color: "#fff",
                                        border: "none", borderRadius: 6, cursor: "pointer", padding: "6px 14px",
                                        fontSize: "0.8rem", fontWeight: 600, display: "flex", gap: 6, alignItems: "center"
                                    }}
                                >
                                    <span>🤖</span> Ask Agent to Draft PR
                                </button>
                            )}
                            <button
                                onClick={() => setApplyState((s) => ({ ...s, result: null }))}
                                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-secondary)", cursor: "pointer", padding: "5px 12px", fontSize: "0.8rem" }}
                            >
                                Close
                            </button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                            {applyState.result.applied.map((a) => (
                                <div key={a.fix_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: "0.82rem" }}>
                                    <span style={{ color: "#22c55e", fontWeight: 600 }}>✓</span>{" "}
                                    <span className="mono" style={{ color: "var(--text-secondary)" }}>{a.file}:{a.line}</span>{" "}
                                    <span style={{ color: "var(--text-muted)" }}>{a.message}</span>
                                </div>
                            ))}
                            {applyState.result.skipped.map((s) => (
                                <div key={s.fix_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: "0.82rem" }}>
                                    <span style={{ color: "var(--severity-warning)", fontWeight: 600 }}>⏭</span>{" "}
                                    <span className="mono" style={{ color: "var(--text-muted)" }}>{s.fix_id}</span>{" "}
                                    <span style={{ color: "var(--text-muted)" }}>{s.reason}</span>
                                </div>
                            ))}
                            {applyState.result.combined_diff && (
                                <pre style={{
                                    marginTop: 16, padding: 14,
                                    background: "var(--surface-1)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 8, fontSize: "0.78rem",
                                    color: "var(--text-secondary)",
                                    overflowX: "auto", whiteSpace: "pre-wrap",
                                }}>
                                    {applyState.result.combined_diff}
                                </pre>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Diff viewer overlay ── */}
            {previewState && (
                <DiffViewer
                    preview={previewState.preview ?? {
                        file: previewState.issue.file,
                        line: previewState.issue.line,
                        source_type: previewState.issue.source_type,
                        risk: "low",
                        supported: true,
                        message: "",
                        original: "",
                        modified: "",
                        diff: "",
                    }}
                    fixId={previewState.issue.fix_id}
                    loading={previewState.loading}
                    onClose={() => setPreviewState(null)}
                />
            )}
        </div>
    );
}
