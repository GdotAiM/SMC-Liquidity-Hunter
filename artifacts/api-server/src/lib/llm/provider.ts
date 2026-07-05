/**
 * Unified LLM Provider Abstraction
 *
 * Supports:
 *   - Fireworks AI (default — existing behavior, zero config change)
 *   - AMD Developer Cloud / vLLM (opt-in via LLM_PROVIDER=amd or LLM_BASE_URL)
 *   - Any OpenAI-compatible endpoint (BYOK — set LLM_BASE_URL + LLM_API_KEY + LLM_MODEL)
 *
 * Environment variables:
 *   LLM_PROVIDER    = "fireworks" (default) | "amd" | "openai" | "custom"
 *   LLM_BASE_URL    = override the base URL (e.g. http://your-mi300x:8000/v1)
 *   LLM_API_KEY     = override the API key
 *   LLM_MODEL       = override the model name
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: "fireworks" | "amd" | "openai" | "custom";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface LlmStreamEvent {
  type: "delta" | "done" | "error";
  content?: string;
  error?: string;
}

// ── Default providers ────────────────────────────────────────────────────────

const FIREWORKS_BASE = "https://api.fireworks.ai/inference/v1";
const FIREWORKS_MODEL = "accounts/fireworks/models/deepseek-v4-pro";

// AMD Developer Cloud — vLLM on MI300X default
const AMD_DEFAULT_BASE = "http://localhost:8000/v1";
const AMD_DEFAULT_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct";

// ── Resolve config from env ──────────────────────────────────────────────────

export function resolveLlmConfig(): LlmConfig {
  const provider = (process.env.LLM_PROVIDER || "fireworks") as LlmConfig["provider"];

  switch (provider) {
    case "amd":
      return {
        provider: "amd",
        baseUrl: process.env.LLM_BASE_URL || AMD_DEFAULT_BASE,
        apiKey: process.env.LLM_API_KEY || "not-needed",
        model: process.env.LLM_MODEL || AMD_DEFAULT_MODEL,
      };
    case "openai":
      return {
        provider: "openai",
        baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
        apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
        model: process.env.LLM_MODEL || "gpt-4o",
      };
    case "custom":
      return {
        provider: "custom",
        baseUrl: process.env.LLM_BASE_URL || FIREWORKS_BASE,
        apiKey: process.env.LLM_API_KEY || process.env.FIREWORKS_API_KEY || "",
        model: process.env.LLM_MODEL || FIREWORKS_MODEL,
      };
    case "fireworks":
    default:
      return {
        provider: "fireworks",
        baseUrl: process.env.LLM_BASE_URL || FIREWORKS_BASE,
        apiKey: process.env.LLM_API_KEY || process.env.FIREWORKS_API_KEY || "",
        model: process.env.LLM_MODEL || FIREWORKS_MODEL,
      };
  }
}

// ── Streaming chat completion ────────────────────────────────────────────────

export async function* streamChatCompletion(
  messages: ChatMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    config?: LlmConfig;
  },
): AsyncGenerator<LlmStreamEvent> {
  const config = options?.config || resolveLlmConfig();

  if (!config.apiKey && config.provider !== "amd") {
    yield { type: "error", error: `Missing API key for provider "${config.provider}". Set LLM_API_KEY or FIREWORKS_API_KEY.` };
    return;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.3,
    stream: true,
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey && config.apiKey !== "not-needed"
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    yield { type: "error", error: `LLM request failed: ${err.message}` };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    yield { type: "error", error: `LLM HTTP ${response.status}: ${errorText.slice(0, 200)}` };
    return;
  }

  if (!response.body) {
    yield { type: "error", error: "No response body from LLM" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          yield { type: "done" };
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield { type: "delta", content: delta };
          if (json.choices?.[0]?.finish_reason === "stop") {
            yield { type: "done" };
            return;
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: "done" };
}

// ── Non-streaming chat completion ────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    config?: LlmConfig;
  },
): Promise<string> {
  const config = options?.config || resolveLlmConfig();

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.3,
    stream: false,
  };

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey && config.apiKey !== "not-needed"
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`LLM HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}
