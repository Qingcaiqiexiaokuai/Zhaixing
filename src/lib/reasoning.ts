import type { AISettings, ReasoningResult, Recording } from "../types";
import { callChatCompletion, type ChatMessage } from "./llm";
import { getIdentityPreset, getReasoningModelPreset } from "./settings";

/** 单条转写送进模型的最大字符数 */
const MAX_REASONING_CHARS = 12000;

/**
 * 动态拼接推演 prompt。
 * 身份 -> 决定「谁在推演」；思维模型 -> 决定「用什么框架推演」。
 */
export function buildReasoningMessages(
  settings: AISettings,
  transcript: string,
): ChatMessage[] {
  const identity = getIdentityPreset(settings.identity);
  const model = getReasoningModelPreset(settings.reasoningModel);

  const source =
    transcript.length > MAX_REASONING_CHARS
      ? `${transcript.slice(0, MAX_REASONING_CHARS)}\n（内容过长，后面已省略）`
      : transcript;

  const system = [
    `你现在是一位资深的【${identity.label}】。`,
    `你的经验与关注点：${identity.persona}。`,
    "",
    `请运用【${model.label}】的思维框架，从根本事实出发，对以下想法进行深度推演。`,
    model.instruction,
    "",
    "硬性要求：",
    "1. 拒绝废话，必须犀利、具体。不要写「要重视用户体验」这类正确但没用的空话。",
    "2. 每个结论都要给出理由或依据，并尽量落到可执行的动作上。",
    "3. 如果原始信息不足以支撑判断，直接指出缺什么信息，绝不编造事实。",
    "4. 用简体中文，用 Markdown 输出：先给一句话结论，再用小标题分点展开。",
    "5. 全程控制在 600 字以内，信息密度优先。",
  ].join("\n");

  const user = [
    `【我的身份】${identity.label}`,
    `【思维模型】${model.label}`,
    "",
    "【原始想法】",
    source,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 追问时最多带多少条历史消息（一问一答 = 2 条，10 条约等于最近 5 轮） */
export const CHAT_HISTORY_LIMIT = 10;
/** 追问时单条历史消息送进模型的最大字符数 */
const MAX_CHAT_MESSAGE_CHARS = 2000;

function truncate(text: string, limit: number): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n（内容过长，后面已省略）`
    : text;
}

/**
 * 追问的消息数组：
 *   system 交代身份／框架 + 原始想法 + 首轮报告（放在 assistant 位置，模型才知道那是它自己写的）
 *   + 最近 CHAT_HISTORY_LIMIT 条历史 + 这次的问题。
 * 只带最近 10 条，避免多轮之后 token 越堆越多。
 */
export function buildReasoningChatMessages(
  settings: AISettings,
  recording: Recording,
  question: string,
): ChatMessage[] {
  const identity = getIdentityPreset(settings.identity);
  const model = getReasoningModelPreset(settings.reasoningModel);
  const report = recording.reasoning?.content ?? "";

  const history: ChatMessage[] = recording.chatHistory
    .filter(
      (message) => message.role !== "system" && message.content.trim().length > 0,
    )
    .slice(-CHAT_HISTORY_LIMIT)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: truncate(message.content.trim(), MAX_CHAT_MESSAGE_CHARS),
    }));

  const system = [
    `你现在是一位资深的【${identity.label}】。`,
    `你的经验与关注点：${identity.persona}。`,
    "",
    `前面你已经基于用户的原始想法，用【${model.label}】的框架给过一份推演报告；`,
    "现在用户要就这份报告继续追问，进入多轮讨论。",
    model.instruction,
    "",
    "硬性要求：",
    "1. 只围绕这份报告和用户的原始想法回答，不要跑题；信息不足就直说缺什么，绝不编造事实。",
    "2. 回答要具体、可执行；能给数字、能给动作就给，别写正确但没用的空话。",
    "3. 如果用户的追问推翻了原报告的前提，直接指出，并给出修正后的结论。",
    "4. 用简体中文，Markdown 输出，全程控制在 600 字以内，信息密度优先。",
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `【原始想法】\n${truncate(
        recording.transcript.trim(),
        MAX_REASONING_CHARS,
      )}`,
    },
    ...(report.length > 0
      ? [{ role: "assistant" as const, content: report }]
      : []),
    ...history,
    { role: "user", content: question },
  ];
}

/** 就已有的推演报告继续追问一轮，返回 AI 的 Markdown 回复。signal 用于删除录音时中断。 */
export async function runReasoningChat(
  settings: AISettings,
  recording: Recording,
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    throw new Error("先输入想问的问题再发送。");
  }
  if (!recording.reasoning) {
    throw new Error("这条录音还没有推演结果，先跑一次定向推演。");
  }

  const result = await callChatCompletion(
    settings,
    buildReasoningChatMessages(settings, recording, trimmed),
    { temperature: 0.5, signal },
  );
  return result.content;
}

/** 对单条录音执行一次定向推演。signal 用于删除录音时中断队列。 */
export async function runReasoning(
  settings: AISettings,
  recording: Recording,
  signal?: AbortSignal,
): Promise<ReasoningResult> {
  const transcript = recording.transcript.trim();
  if (transcript.length === 0) {
    throw new Error("这条录音还没有转写文字，无法推演。");
  }

  const identity = getIdentityPreset(settings.identity);
  const model = getReasoningModelPreset(settings.reasoningModel);

  const result = await callChatCompletion(
    settings,
    buildReasoningMessages(settings, transcript),
    { temperature: 0.6, signal },
  );

  return {
    identity: identity.id,
    model: model.id,
    identityLabel: identity.label,
    modelLabel: model.label,
    content: result.content,
    llmModel: result.model,
    createdAt: Date.now(),
  };
}
