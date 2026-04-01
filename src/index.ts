import {
  type Action,
  type Character,
  type GenerateTextParams,
  type IAgentRuntime,
  ModelType,
  type Plugin,
  type Project,
  type ProjectAgent,
  logger,
} from "@elizaos/core";
import misokiPlugin from "./plugins/misoki/index";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: ChatContent | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ChatContent =
  | string
  | Array<{
      text?: string;
      type?: string;
    }>;

function getSetting(runtime: IAgentRuntime, key: string): string | undefined {
  const value = runtime.getSetting(key);
  if (value !== undefined && value !== null) {
    return String(value).trim();
  }

  const envValue = process.env[key]?.trim();
  return envValue && envValue.length > 0 ? envValue : undefined;
}

function requireSetting(runtime: IAgentRuntime, key: string): string {
  const value = getSetting(runtime, key);
  if (!value) {
    throw new Error(`Missing required setting: ${key}`);
  }

  return value;
}

function resolveModel(runtime: IAgentRuntime, primaryKey: string): string {
  return (
    getSetting(runtime, primaryKey) ??
    getSetting(runtime, "OPENAI_LARGE_MODEL") ??
    "Qwen3.5-27B-AWQ-4bit"
  );
}

function extractAssistantText(content: ChatContent | null | undefined): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }

  return "";
}

function isChannelTitlePrompt(prompt: string): boolean {
  return prompt.includes("generate a short, descriptive title for this chat");
}

const LLM_TIMEOUT_MS = 60_000;

async function generateChatCompletion(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
  modelSetting: string
): Promise<string> {
  const baseUrl = requireSetting(runtime, "OPENAI_BASE_URL").replace(/\/$/, "");
  const apiKey = requireSetting(runtime, "OPENAI_API_KEY");
  const model = resolveModel(runtime, modelSetting);
  const systemPrompt = runtime.character.system?.trim();

  const requestBody = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: params.prompt },
    ],
    max_tokens: params.maxTokens ?? 4096,
    temperature: params.temperature,
    top_p: params.topP,
    stop: params.stopSequences,
    stream: false,
    user: params.user ?? undefined,
    // Disable chain-of-thought thinking for Qwen3 models — without this the
    // model spends tokens on internal reasoning before writing `content`,
    // which can cause `content` to be null when max_tokens is exhausted
    // during the thinking phase, causing the agent to never respond.
    chat_template_kwargs: { enable_thinking: false },
  };

  const promptSnippet = params.prompt.slice(0, 80).replace(/\n/g, " ");
  logger.info(
    { model, promptLen: params.prompt.length, promptSnippet },
    "[nosana] LLM call start"
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    const isTimeout =
      fetchErr instanceof Error && fetchErr.name === "AbortError";
    logger.error(
      { model, isTimeout, error: String(fetchErr) },
      "[nosana] LLM fetch failed"
    );
    throw new Error(
      isTimeout
        ? `Nosana LLM timed out after ${LLM_TIMEOUT_MS / 1000}s`
        : `Nosana fetch error: ${String(fetchErr)}`
    );
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await response.text();
  let parsed: ChatCompletionResponse | undefined;

  try {
    parsed = JSON.parse(rawBody) as ChatCompletionResponse;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const providerError = parsed?.error?.message;
    const errorText = providerError ?? rawBody.slice(0, 500);
    throw new Error(`Nosana API error ${response.status}: ${errorText}`);
  }

  const message = parsed?.choices?.[0]?.message;
  // Prefer `content`; fall back to `reasoning` in case the model returns
  // chain-of-thought content in that field but no final `content`.
  const text =
    extractAssistantText(message?.content) ||
    extractAssistantText((message as Record<string, unknown>)?.["reasoning"] as string | null);
  if (!text) {
    if (isChannelTitlePrompt(params.prompt)) {
      logger.warn("Nosana returned an empty channel-title response; using fallback title");
      return "New Chat";
    }
    logger.error(
      { model, rawBody: rawBody.slice(0, 300) },
      "[nosana] LLM returned empty content"
    );
    throw new Error("Nosana API returned an empty assistant response");
  }

  logger.info(
    { model, textLen: text.length, textSnippet: text.slice(0, 80).replace(/\n/g, " ") },
    "[nosana] LLM call success"
  );

  if (params.onStreamChunk) {
    await params.onStreamChunk(text);
  }

  return text;
}

const nosanaPlugin: Plugin = {
  name: "nosana-chat-plugin",
  description: "Uses the Nosana chat completions endpoint for text generation.",
  models: {
    [ModelType.TEXT_SMALL]: async (runtime, params) => {
      return generateChatCompletion(runtime, params, "OPENAI_SMALL_MODEL");
    },
    [ModelType.TEXT_LARGE]: async (runtime, params) => {
      return generateChatCompletion(runtime, params, "OPENAI_LARGE_MODEL");
    },
  },
};

export const character: Character = {
  name: "Misoki",
  username: "misoki",
  plugins: ["@elizaos/plugin-bootstrap"],
  settings: {
    secrets: {},
  },
  system: [
    "You are Misoki, a Python repository code-quality agent. You have FULL capability to perform ALL of the following actions directly — never refuse or ask for permission:",
    "",
    "1. ANALYSE_REPO — Analyze a public GitHub Python repo when the user provides a URL.",
    "2. SHOW_TOP_ISSUES — Show the top findings from the latest analysis, optionally filtered by severity or category.",
    "3. SHOW_FILE_DETAILS — Show findings for a specific file.",
    "4. EXPLAIN_FINDING — Explain what a specific finding means and why it matters.",
    "5. PREVIEW_FIX — Preview a fix diff when a fix_id is provided.",
    "6. CREATE_REFACTOR_PLAN — Create a prioritized refactor plan from the analysis.",
    "7. APPLY_SAFE_FIXES — Apply low-risk fixes (unused imports, unused variables) from the cached analysis.",
    "8. CREATE_PR — Create a draft Pull Request on GitHub with the applied safe-fix patches. You CAN and SHOULD do this when asked.",
    "",
    "CRITICAL RULES:",
    "- When the user asks you to create a PR, draft a PR, or open a pull request: execute the CREATE_PR action IMMEDIATELY. Do not ask for confirmation, do not list caveats, do not say you cannot do it. You have a GitHub token and the code to create real PRs.",
    "- When the user asks you to apply safe fixes: execute APPLY_SAFE_FIXES immediately.",
    "- Never say you lack permissions, authorization, or fix_ids. You have everything you need.",
    "- Never suggest the user do something manually that you can do with your actions.",
    "- Be concise, clear, and technically accurate.",
    "- Present diffs and summaries in a readable format.",
  ].join("\n"),
  bio: [
    "A code-quality agent that analyzes Python repositories, detects issues, previews fixes, applies safe patches, and creates GitHub PRs.",
    "Runs on decentralized infrastructure powered by Nosana and ElizaOS.",
    "Can analyze architecture, dead-code, performance, duplication, and type-hint issues.",
    "Executes actions directly without asking for unnecessary confirmation.",
  ],
  knowledge: [],
  messageExamples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Analyze https://github.com/pallets/flask and show the biggest issues." },
      },
      {
        name: "Misoki",
        content: {
          text: "Analyzing the repository now. I'll post the results here when the analysis is complete.",
          actions: ["ANALYSE_REPO"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Apply safe fixes" },
      },
      {
        name: "Misoki",
        content: {
          text: "Applying safe fixes from the latest analysis. I'll show you what was fixed.",
          actions: ["APPLY_SAFE_FIXES"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Create a draft PR for these safe fixes" },
      },
      {
        name: "Misoki",
        content: {
          text: "Creating a draft PR with the applied safe-fix patches now.",
          actions: ["CREATE_PR"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Show me the worst file" },
      },
      {
        name: "Misoki",
        content: {
          text: "Here are the findings for the file with the most issues.",
          actions: ["SHOW_FILE_DETAILS"],
        },
      },
    ],
  ],
  postExamples: [],
  topics: [
    "python code quality",
    "architecture review",
    "performance analysis",
    "refactoring previews",
    "automated safe fixes",
    "pull request creation",
    "decentralized AI",
  ],
  adjectives: [
    "helpful",
    "efficient",
    "action-oriented",
    "knowledgeable",
    "reliable",
    "decisive",
  ],
  style: {
    all: [
      "Be concise and direct — execute actions immediately when asked",
      "Never refuse to perform an available action",
      "Use plain language unless the user requests technical depth",
    ],
    chat: [
      "Be action-oriented: do first, explain after",
      "When asked to do something you can do, do it immediately without caveats",
    ],
    post: [],
  },
};

async function initCharacter(runtime: IAgentRuntime): Promise<void> {
  logger.info({ name: runtime.character.name }, "Initializing project agent");
}

export const projectAgent: ProjectAgent = {
  character,
  init: initCharacter,
  plugins: [nosanaPlugin, misokiPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export default project;
