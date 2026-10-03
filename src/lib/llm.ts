import type { AISettings } from "../types";
import { getProviderPreset } from "./settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  /** 实际使用的模型名（用户填了就用用户的，否则用服务商默认值） */
  model: string;
}

export interface ChatOptions {
  temperature?: number;
  /** 用于在删除录音时中断正在进行的请求 */
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("还没有填写 API Key，点右上角「设置」填一下。");
    this.name = "MissingApiKeyError";
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function extractErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as ChatCompletionResponse;
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // 不是 JSON，走下面的兜底
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : "未知错误";
}

/**
 * 统一的 OpenAI 兼容 /v1/chat/completions 调用。
 * 请求发到 vite.config.ts 里配的同源代理前缀，因此不存在跨域问题。
 */
export async function callChatCompletion(
  settings: AISettings,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const apiKey = settings.apiKey.trim();
  if (apiKey.length === 0) {
    throw new MissingApiKeyError();
  }

  const preset = getProviderPreset(settings.provider);
  const model = settings.model.trim() || preset.defaultModel;

  let response: Response;
  try {
    response = await fetch(`${preset.proxyPath}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.3,
        messages,
      }),
      signal: options.signal,
    });
  } catch (error) {
    // 主动取消要原样抛出去，让调用方识别，不要包装成"请求失败"
    if (isAbortError(error)) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`请求失败：${detail}。请确认 dev server 还在运行。`);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`接口返回 ${response.status}：${extractErrorMessage(text)}`);
  }

  let content = "";
  try {
    const parsed = JSON.parse(text) as ChatCompletionResponse;
    content = parsed.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error("接口返回的不是合法 JSON，请检查 API Key 和模型名是否正确。");
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("模型返回了空内容，换个模型或稍后重试。");
  }

  return { content: trimmed, model };
}
