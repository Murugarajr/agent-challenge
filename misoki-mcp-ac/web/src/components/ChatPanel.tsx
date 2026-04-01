"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "agent"; text: string; ts: number };
type Props = { repoUrl: string | null; initialPrompt?: string | null };

export type ChatPanelRef = {
    sendExternalMessage: (text: string) => void;
};

// ElizaOS instance constants
const AGENT_NAME = "Misoki";
const SERVER_ID  = "00000000-0000-0000-0000-000000000000";
const USER_ID    = "bdd86d1e-5f9e-475a-ae1e-cfad97f3da17";
const USER_NAME  = "Misoki User";

// All ElizaOS calls go through the Next.js API proxy (no CORS)
const PROXY = "/api/agent";

// How long to wait for agent reply before giving up (ms)
const REPLY_TIMEOUT_MS = 300_000; // 5 minutes — LLM can be slow
const POLL_INTERVAL_MS = 2_000;

export default forwardRef<ChatPanelRef, Props>(function ChatPanel({ repoUrl, initialPrompt }, ref) {
    const [messages, setMessages] = useState<Message[]>([{
        role: "agent", ts: Date.now(),
        text: repoUrl
            ? `Repository **${repoUrl}** analysed. Ask me:\n- "Show me the worst file"\n- "Explain the top critical issue"\n- "Create a refactor plan"`
            : "Hello! Paste a GitHub repository URL to get started.",
    }]);
    const [input, setInput]         = useState("");
    const [sending, setSending]     = useState(false);
    const [channelId, setChannelId] = useState<string | null>(null);
    const [agentId, setAgentId]     = useState<string | null>(null);
    const [status, setStatus]       = useState<"connecting" | "ready" | "error">("connecting");
    // Track whether the agent has been primed with the repo URL
    const [agentPrimed, setAgentPrimed] = useState(false);
    const [agentPrimeDone, setAgentPrimeDone] = useState(false);
    const bottomRef   = useRef<HTMLDivElement>(null);
    const pollTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
    // We track the timestamp at which we sent the user message,
    // so we only pick up agent replies that arrive AFTER that point.
    const sentAtRef   = useRef<number>(0);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Step 1: Discover the Misoki agent ID dynamically, then find its channel
    useEffect(() => {
        let dead = false;
        (async () => {
            try {
                // Fetch all registered agents and find the one named "Misoki"
                const agentsRes = await fetch(`${PROXY}/api/agents`);
                const agentsJson = await agentsRes.json() as {
                    success: boolean;
                    data: { agents: Array<{ id: string; name: string }> };
                };
                if (!agentsJson.success) throw new Error("agents list failed");

                const misoki = agentsJson.data.agents.find(
                    (a) => a.name.toLowerCase() === AGENT_NAME.toLowerCase()
                );
                if (!misoki) throw new Error(`No agent named "${AGENT_NAME}" found`);

                const resolvedAgentId = misoki.id;
                if (!dead) setAgentId(resolvedAgentId);

                // Now find the channel for this agent
                const r = await fetch(`${PROXY}/api/messaging/message-servers/${SERVER_ID}/channels`);
                const j = await r.json() as {
                    success: boolean;
                    data: { channels: Array<{ id: string; metadata: { forAgent?: string } }> };
                };
                if (!j.success) throw new Error("channel list failed");
                const ch = j.data.channels.find(c => c.metadata?.forAgent === resolvedAgentId);
                if (!ch) throw new Error("no DM channel found for Misoki agent");
                if (!dead) { setChannelId(ch.id); setStatus("ready"); }
            } catch (e) {
                console.error("ChatPanel init:", e);
                if (!dead) setStatus("error");
            }
        })();
        return () => { dead = true; };
    }, []);

    // Auto-trigger agent analysis when channel is ready and we have a repo URL.
    // This seeds the agent's in-memory cache so follow-up commands work.
    useEffect(() => {
        if (!channelId || status !== "ready" || agentPrimed) return;
        
        if (!repoUrl) {
            setAgentPrimeDone(true);
            return;
        }

        setAgentPrimed(true);

        (async () => {
            try {
                await fetch(`${PROXY}/api/messaging/channels/${channelId}/messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        channelId,
                        message_server_id: SERVER_ID,
                        author_id: USER_ID,
                        content: `Analyze ${repoUrl}`,
                        source_type: "eliza_gui",
                        metadata: { user_display_name: USER_NAME, auto_prime: true },
                    }),
                });
            } catch {
                // Silent — priming is best-effort
            } finally {
                setAgentPrimeDone(true);
            }
        })();
    }, [channelId, repoUrl, agentPrimed, status]);

    // Poll for agent replies created AFTER the message we sent
    const pollForReply = useCallback(async (chId: string, afterTs: number): Promise<boolean> => {
        if (!agentId) return false;
        try {
            const r = await fetch(`${PROXY}/api/messaging/channels/${chId}/messages?limit=20`);
            if (!r.ok) return false;
            const j = await r.json() as {
                success: boolean;
                data: { messages: Array<{ id: string; authorId: string; content: string; createdAt: string | number }> };
            };
            if (!j.success) return false;

            // ElizaOS uses string ISO dates in GET, but could return numbers; be robust
            const replies = j.data.messages.filter(m => {
                if (m.authorId !== agentId) return false;
                const mTs = typeof m.createdAt === "number" ? m.createdAt : Date.parse(m.createdAt as string);
                return mTs > afterTs;
            });

            if (replies.length > 0) {
                const latest = replies[replies.length - 1];
                const latestTs = typeof latest.createdAt === "number" ? latest.createdAt : Date.parse(latest.createdAt as string);
                setMessages(prev => [...prev, { role: "agent", text: latest.content, ts: latestTs }]);
                setSending(false);
                return true;
            }
        } catch { /* silent */ }
        return false;
    }, [agentId]);

    // Polling loop — runs while `sending === true`
    useEffect(() => {
        if (!sending || !channelId) return;

        const chId       = channelId; // capture for closure (TS narrowing)
        const startedAt  = Date.now();
        let   stopped    = false;

        async function tick() {
            if (stopped) return;

            const elapsed = Date.now() - startedAt;
            if (elapsed >= REPLY_TIMEOUT_MS) {
                setSending(false);
                setMessages(prev => [...prev, {
                    role: "agent",
                    text: `⏱ The agent is taking a while (the LLM may be busy). Please try again in a moment.`,
                    ts: Date.now(),
                }]);
                return;
            }

            const got = await pollForReply(chId, sentAtRef.current);
            if (got || stopped) return;

            pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
        }

        // Small initial delay to give ElizaOS time to receive the socket event
        pollTimer.current = setTimeout(tick, 2000);
        return () => {
            stopped = true;
            if (pollTimer.current) clearTimeout(pollTimer.current);
        };
    }, [sending, channelId, pollForReply]);

    const [pendingPrompt, setPendingPrompt] = useState(initialPrompt);

    useEffect(() => {
        if (status === "ready" && channelId && pendingPrompt && !sending && agentPrimeDone) {
            sendMessage(undefined, pendingPrompt);
            setPendingPrompt(null);
        }
    }, [status, channelId, pendingPrompt, sending, agentPrimeDone]); // eslint-disable-line react-hooks/exhaustive-deps

    async function sendMessage(e?: React.FormEvent, overrideText?: string) {
        if (e) e.preventDefault();
        const text = (overrideText ?? input).trim();
        if (!text || sending || !channelId) return;

        if (!overrideText) setInput("");
        const ts = Date.now();
        sentAtRef.current = ts; // record when we sent so polling can filter by it
        setMessages(prev => [...prev, { role: "user", text, ts }]);
        setSending(true);

        // Do NOT append the repo URL — it breaks follow-up action validators
        // (they reject messages containing GitHub URLs). The agent already has
        // the analysis cached from the auto-prime message sent on connect.
        const content = text;

        try {
            const r = await fetch(`${PROXY}/api/messaging/channels/${channelId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    channelId,
                    message_server_id: SERVER_ID,
                    author_id: USER_ID,
                    content,
                    source_type: "eliza_gui",
                    metadata: { user_display_name: USER_NAME },
                }),
            });

            const j = await r.json() as { success?: boolean; userMessage?: { id: string; created_at?: number }; error?: string };
            if (!r.ok || j.success === false) throw new Error(j.error ?? `HTTP ${r.status}`);
            // Use the server-assigned created_at if available for more accurate filtering
            if (j.userMessage?.created_at) sentAtRef.current = j.userMessage.created_at;

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setMessages(prev => [...prev, {
                role: "agent",
                text: `⚠ Could not send message: ${msg}\n\nMake sure ElizaOS is running at http://localhost:3000.`,
                ts: Date.now(),
            }]);
            setSending(false);
        }
    }

    const dotColor = status === "ready" ? "#22c55e" : status === "error" ? "#ef4444" : "#f59e0b";
    const dotGlow  = status === "ready" ? "0 0 6px #22c55e" : "none";

    useImperativeHandle(ref, () => ({
        sendExternalMessage: (text: string) => {
            sendMessage(undefined, text);
        }
    }), [input, sending, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

            {/* Header */}
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, boxShadow: dotGlow, display: "inline-block", transition: "all 0.3s" }} />
                <h3 style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", flex: 1 }}>
                    Misoki Agent
                </h3>
                {status === "connecting" && <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>connecting…</span>}
                {status === "error"      && <span style={{ fontSize: "0.68rem", color: "#ef4444" }}>offline</span>}
                {sending && <span style={{ fontSize: "0.68rem", color: "var(--accent-cyan)" }}>thinking…</span>}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                            maxWidth: "88%", padding: "9px 13px",
                            borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                            background: msg.role === "user" ? "linear-gradient(135deg, #e65c00, #ff8d00)" : "var(--surface-1)",
                            border: msg.role === "user" ? "none" : "1px solid var(--border)",
                            fontSize: "0.83rem", color: "var(--text-primary)", lineHeight: 1.55,
                            wordBreak: "break-word",
                            whiteSpace: msg.role === "user" ? "pre-wrap" : "normal",
                        }}>
                            {msg.role === "agent" ? (
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        p: ({node, ...props}) => <p style={{margin: "0 0 8px 0"}} {...props} />,
                                        h1: ({node, ...props}) => <h1 style={{fontSize: "1.1rem", fontWeight: "bold", margin: "14px 0 8px"}} {...props} />,
                                        h2: ({node, ...props}) => <h2 style={{fontSize: "1.05rem", fontWeight: "bold", margin: "14px 0 8px"}} {...props} />,
                                        h3: ({node, ...props}) => <h3 style={{fontSize: "1rem", fontWeight: "bold", margin: "14px 0 8px"}} {...props} />,
                                        ul: ({node, ...props}) => <ul style={{margin: "0 0 8px 0", paddingLeft: "20px", listStyleType: "disc"}} {...props} />,
                                        ol: ({node, ...props}) => <ol style={{margin: "0 0 8px 0", paddingLeft: "20px", listStyleType: "decimal"}} {...props} />,
                                        li: ({node, ...props}) => <li style={{margin: "4px 0"}} {...props} />,
                                        strong: ({node, ...props}) => <strong style={{fontWeight: 700, color: "var(--text-primary)"}} {...props} />,
                                        a: ({node, ...props}) => <a style={{color: "var(--accent-cyan)", textDecoration: "underline"}} {...props} />,
                                        hr: ({node, ...props}) => <hr style={{margin: "12px 0", border: "none", borderTop: "1px solid var(--border)"}} {...props} />,
                                        pre: ({node, ...props}) => (
                                            <pre style={{
                                                background: "var(--surface-2)", padding: "10px", 
                                                borderRadius: "6px", overflowX: "auto", margin: "8px 0",
                                                border: "1px solid var(--border)", WebkitFontSmoothing: "subpixel-antialiased"
                                            }} {...props} />
                                        ),
                                        code: ({node, className, ...props}) => (
                                            <code style={{
                                                background: className ? "transparent" : "var(--surface-2)", 
                                                padding: className ? "0" : "2px 5px", 
                                                borderRadius: "4px", fontSize: "0.85em", 
                                                color: className ? "inherit" : "var(--accent-orange)"
                                            }} className={className} {...props} />
                                        )
                                    }}
                                >
                                    {msg.text}
                                </ReactMarkdown>
                            ) : (
                                msg.text
                            )}
                        </div>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 3, paddingInline: 2 }}>
                            {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    </div>
                ))}
                {sending && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {[0, 1, 2].map(i => (
                            <span key={i} style={{
                                width: 6, height: 6, borderRadius: "50%", background: dotColor,
                                animation: "pulse-glow 1.2s ease infinite", animationDelay: `${i * 0.2}s`,
                                display: "inline-block",
                            }} />
                        ))}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
                <input
                    className="input"
                    style={{ flex: 1, fontSize: "0.85rem" }}
                    placeholder={
                        status === "error" ? "Agent offline" :
                        status === "connecting" ? "Connecting…" :
                        sending ? "Waiting for reply…" : "Ask the agent…"
                    }
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={sending || status !== "ready"}
                />
                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={sending || !input.trim() || status !== "ready"}
                    style={{ padding: "8px 14px" }}
                >
                    {sending ? (
                        <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                    ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    )}
                </button>
            </form>
        </div>
    );
});
