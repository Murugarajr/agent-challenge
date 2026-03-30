"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeRepo } from "@/lib/api";

const EXAMPLE_REPOS = [
  "https://github.com/pallets/flask",
  "https://github.com/psf/requests",
  "https://github.com/pydantic/pydantic",
];

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const router = useRouter();

  const isValidGithubUrl = (val: string) =>
    /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(val.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidGithubUrl(url)) {
      setError("Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)");
      return;
    }
    setLoading(true);
    setProgress("Fetching repository tree…");
    try {
      setProgress("Running AST analyzers…");
      const result = await analyzeRepo(url.trim());
      sessionStorage.setItem("misoki_analysis", JSON.stringify(result));
      setProgress("Analysis complete! Redirecting…");
      router.push("/results");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setProgress("");
    }
  }

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column" }}>
      {/* ── Hero ── */}
      <section style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px 60px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Background orbs */}
        <div style={{
          position: "absolute", width: 600, height: 600,
          borderRadius: "50%", top: -200, left: "50%", transform: "translateX(-60%)",
          background: "radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", width: 400, height: 400,
          borderRadius: "50%", bottom: -100, right: "15%",
          background: "radial-gradient(circle, rgba(6,182,212,0.10) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Badge */}
        <div className="anim-fade-up" style={{ animationDelay: "0ms" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 16px",
            background: "var(--surface-1)",
            border: "1px solid rgba(139,92,246,0.35)",
            borderRadius: 99,
            fontSize: "0.78rem", fontWeight: 600,
            color: "var(--accent-purple)",
            marginBottom: 28,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-purple)", display: "inline-block", animation: "pulse-glow 2s infinite" }} />
            Powered by Nosana · ElizaOS · ohm-mcp
          </span>
        </div>

        <h1 className="anim-fade-up" style={{ animationDelay: "60ms", marginBottom: 16, maxWidth: 720 }}>
          Code Quality Analysis,{" "}
          <span className="gradient-text">Supercharged by AI</span>
        </h1>

        <p className="anim-fade-up" style={{
          animationDelay: "120ms",
          fontSize: "1.15rem", color: "var(--text-secondary)",
          maxWidth: 540, marginBottom: 48, lineHeight: 1.7,
        }}>
          Paste a public Python repository URL. Misoki scans for dead code,
          architecture smells, duplicate blocks, and more — then shows you
          previewable diffs to fix them.
        </p>

        {/* Input form */}
        <div className="anim-fade-up" style={{ animationDelay: "180ms", width: "100%", maxWidth: 640 }}>
          <form onSubmit={handleSubmit}>
            <div style={{
              display: "flex", gap: 10,
              background: "var(--surface-1)",
              border: `1px solid ${error ? "var(--severity-critical)" : "var(--border-bright)"}`,
              borderRadius: 12,
              padding: 6,
              boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
              transition: "border-color 0.2s",
            }}>
              <input
                className="input"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "10px 12px",
                  flex: 1,
                  fontSize: "0.95rem",
                }}
                type="url"
                placeholder="https://github.com/owner/repo"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                disabled={loading}
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !url.trim()}
                style={{ whiteSpace: "nowrap", minWidth: 120 }}
              >
                {loading ? (
                  <>
                    <span style={{
                      width: 14, height: 14, borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      animation: "spin 0.7s linear infinite",
                      display: "inline-block",
                    }} />
                    Analysing…
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                    Analyse
                  </>
                )}
              </button>
            </div>

            {loading && progress && (
              <p style={{ marginTop: 10, fontSize: "0.82rem", color: "var(--accent-cyan)", display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                {progress}
              </p>
            )}

            {error && (
              <p style={{ marginTop: 10, fontSize: "0.82rem", color: "var(--severity-critical)", display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </p>
            )}
          </form>

          {/* Example repos */}
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Try:</span>
            {EXAMPLE_REPOS.map((repo) => {
              const name = repo.split("/").slice(-2).join("/");
              return (
                <button
                  key={repo}
                  className="btn-ghost btn btn-sm"
                  type="button"
                  onClick={() => setUrl(repo)}
                  disabled={loading}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </section >

      {/* ── Feature strip ── */}
      < section style={{ borderTop: "1px solid var(--border)", padding: "48px 24px" }
      }>
        <div className="container">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            {[
              { icon: "🏗️", title: "Architecture & design", desc: "Detect violations and get pattern suggestions with DI refactors.", badge: "God objects · SOLID", inlineBadge: null },
              { icon: "🔧", title: "Code refactoring", desc: "Extract methods, detect dead code, refactor imports, and rename symbols safely.", badge: null, inlineBadge: "AST-true" },
              { icon: "📊", title: "Type safety & tests", desc: "Analyze type coverage, generate stubs, and auto-create tests for safe refactors.", badge: null, inlineBadge: null },
              { icon: "⚡", title: "Performance hotspots", desc: "Catch performance smells and prioritize fixes by coverage.", badge: null, inlineBadge: null },
              { icon: "🤖", title: "Automated, reversible execution", desc: "Dry-run, backup, apply patches, run tests, and auto-rollback on failure.", badge: null, inlineBadge: null },
              { icon: "📈", title: "Quality dashboard", desc: "Generate HTML, Markdown, and JSON reports with health scores and metrics.", badge: null, inlineBadge: null },
              { icon: "🧬", title: "Project-wide symbol ops", desc: "Safely rename symbols across the entire project with conflict detection.", badge: null, inlineBadge: null },
              { icon: "📦", title: "Safer module migrations", desc: "Refactor imports when moving modules, keeping all call sites in sync.", badge: null, inlineBadge: null },
            ].map(({ icon, title, desc, badge, inlineBadge }) => (
              <div key={title} className="glass glass-hover" style={{ padding: "22px 24px", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: badge ? 10 : 16 }}>
                  <span style={{ fontSize: "1.25rem", display: "flex" }}>{icon}</span>
                  <h3 style={{ fontSize: "1.05rem", fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h3>
                  {inlineBadge && (
                    <span style={{ fontSize: "0.65rem", background: "var(--surface-3)", padding: "2px 8px", borderRadius: 99, color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {inlineBadge}
                    </span>
                  )}
                </div>
                {badge && (
                  <div style={{ marginBottom: 14 }}>
                    <span style={{ fontSize: "0.7rem", background: "rgba(255,255,255,0.06)", padding: "3px 12px", borderRadius: 99, color: "var(--text-secondary)" }}>
                      {badge}
                    </span>
                  </div>
                )}
                <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "auto" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div >
  );
}
