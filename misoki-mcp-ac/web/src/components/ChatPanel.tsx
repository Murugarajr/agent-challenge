"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "agent"; text: string; ts: number };

type Props = {
    repoUrl: string | null;
    analysisContext?: string;
};

export default function ChatPanel({ repoUrl, analysisContext }: Props) {
    const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL;
    const [messages, setMessages] = useState<Message[]>([
        {
            role: "agent",
            text: repoUrl
                ? `Repository **${repoUrl}** has been analysed. You can ask me:\n- "Show me the worst file"\n- "Explain the top critical issue"\n- "Create a refactor plan"\n- "Preview fix <fix_id> for ${repoUrl}"`
                : "Hello! Paste a GitHub repository URL to get started with analysis.",
            ts: Date.now(),
        },
    ]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    async function sendMessage(e: React.FormEvent) {
        e.preventDefault();
        if (!input.trim() || sending) return;

        const text = input.trim();
        setInput("");
        setMessages((prev) => [...prev, { role: "user", text, ts: Date.now() }]);
        setSending(true);

        try {
            if (!agentUrl) {
                throw new Error("Agent URL not configured. Set NEXT_PUBLIC_AGENT_URL.");
            }

            // Build the full message with context if needed
            const fullText = repoUrl && !text.includes("github.com")
                ? `${text} (Repo: ${repoUrl})`
                : text;

            const res = await fetch(`${agentUrl}/api/messaging/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: fullText }),
            });

            if (!res.ok) throw new Error(`Agent returned ${res.status}`);
            const data = await res.json() as { response?: string; text?: string };
            const reply = data.response ?? data.text ?? "No response received.";
            setMessages((prev) => [...prev, { role: "agent", text: reply, ts: Date.now() }]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setMessages((prev) => [
                ...prev,
                {
                    role: "agent",
                    text: `⚠ Could not reach the agent: ${msg}\n\nMake sure the ElizaOS agent is running at **${agentUrl ?? "NEXT_PUBLIC_AGENT_URL"}**.`,
                    ts: Date.now(),
                },
            ]);
        } finally {
            setSending(false);
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", gap: 8,
            }}>
                <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: agentUrl ? "var(--severity-info)" : "var(--text-muted)",
                    display: "inline-block",
                    boxShadow: agentUrl ? "0 0 6px var(--severity-info)" : "none",
                }} />
                <h3 style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Misoki Agent
                </h3>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                            maxWidth: "88%",
                            padding: "9px 13px",
                            borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                            background: msg.role === "user"
                                ? "linear-gradient(135deg, var(--accent-purple), #6d28d9)"
                                : "var(--surface-1)",
                            border: msg.role === "user" ? "none" : "1px solid var(--border)",
                            fontSize: "0.83rem",
                            color: "var(--text-primary)",
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}>
                            {msg.text}
                        </div>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 3, paddingLeft: 2, paddingRight: 2 }}>
                            {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    </div>
                ))}
                {sending && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 2 }}>
                        {[0, 1, 2].map((i) => (
                            <span key={i} style={{
                                width: 6, height: 6, borderRadius: "50%",
                                background: "var(--text-muted)",
                                animation: "pulse-glow 1.2s ease infinite",
                                animationDelay: `${i * 0.2}s`,
                                display: "inline-block",
                            }} />
                        ))}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} style={{
                padding: "12px 14px",
                borderTop: "1px solid var(--border)",
                display: "flex", gap: 8,
            }}>
                <input
                    className="input"
                    style={{ flex: 1, fontSize: "0.85rem" }}
                    placeholder={agentUrl ? "Ask the agent…" : "Agent offline"}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={sending || !agentUrl}
                />
                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={sending || !input.trim() || !agentUrl}
                    style={{ padding: "8px 14px" }}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                </button>
            </form>
        </div>
    );
}
