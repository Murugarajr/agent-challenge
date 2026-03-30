import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Misoki — Python Repository Analysis",
  description:
    "AI-powered code quality analysis for Python repositories. Detect architecture issues, dead code, duplication, and more.",
  openGraph: {
    title: "Misoki",
    description: "Analyze Python repos. Preview fixes. Ship better code.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          borderBottom: "1px solid var(--border)",
          background: "rgba(10,12,18,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}>
          <div className="container" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 56,
          }}>
            <a href="/" style={{
              display: "flex", alignItems: "center", gap: 10, color: "var(--text-primary)",
              textDecoration: "none",
            }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="13" stroke="url(#g)" strokeWidth="2" />
                <path d="M8 20 L14 8 L20 20" stroke="url(#g)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 16 H18" stroke="url(#g)" strokeWidth="1.5" strokeLinecap="round" />
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#8b5cf6" />
                    <stop offset="1" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
              </svg>
              <span style={{ fontWeight: 700, fontSize: "1.1rem", letterSpacing: "-0.01em" }}>
                Misoki
              </span>
            </a>
            <nav style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--text-secondary)", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                </svg>
                GitHub
              </a>
              <span style={{
                padding: "3px 10px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 99,
                fontSize: "0.72rem",
                color: "var(--text-secondary)",
                fontWeight: 600,
              }}>
                Nosana × ElizaOS
              </span>
            </nav>
          </div>
        </header>
        <main style={{ paddingTop: 56 }}>
          {children}
        </main>
      </body>
    </html>
  );
}
