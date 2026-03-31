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
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

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

  const text = extractAssistantText(parsed?.choices?.[0]?.message?.content);
  if (!text) {
    if (isChannelTitlePrompt(params.prompt)) {
      logger.warn("Nosana returned an empty channel-title response; using fallback title");
      return "New Chat";
    }
    throw new Error("Nosana API returned an empty assistant response");
  }

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
  name: "MyAgent",
  username: "myagent",
  plugins: ["@elizaos/plugin-bootstrap"],
  settings: {
    secrets: {},
  },
  system:
    "You are Misoki, a Python repository analysis assistant running on decentralized infrastructure powered by Nosana. When the user shares a public GitHub repository URL, analyze it and summarize the most important architecture, performance, and code quality findings. When a valid fix_id is provided, preview the fix and show the diff summary. Be concise, clear, and technically accurate.",
  bio: [
    "A repository analysis assistant running on decentralized infrastructure.",
    "Finds architecture, dead-code, performance, and type-hint issues in Python repositories.",
    "Can preview safe fixes from the Misoki analysis service.",
    "Built for the Nosana x ElizaOS builders challenge.",
  ],
  knowledge: [],
  messageExamples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Analyze https://github.com/pallets/flask and show the biggest issues." },
      },
      {
        name: "MyAgent",
        content: {
          text: "I can analyze a public GitHub Python repository, summarize the top findings, and show previewable fix IDs for safe changes.",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Preview fix dead_code:src/flask/app.py:1:unused_import for https://github.com/pallets/flask",
        },
      },
      {
        name: "MyAgent",
        content: {
          text: "I can preview a supported fix and show you a diff snippet before anything is applied.",
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
    "decentralized AI",
  ],
  adjectives: [
    "helpful",
    "efficient",
    "privacy-focused",
    "knowledgeable",
    "reliable",
  ],
  style: {
    all: [
      "Be concise and direct",
      "Prioritize the user's privacy and autonomy",
      "Use plain language unless the user requests technical depth",
    ],
    chat: [
      "Be conversational and friendly",
      "Ask clarifying questions when the request is ambiguous",
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
