import type { AISettings, AISummary, Recording } from "../types";
import { callChatCompletion } from "./llm";

/** 送进模型的最大字符数，超出部分直接截断并在提示词里说明 */
const MAX_PROMPT_CHARS = 30000;

const SYSTEM_PROMPT = [
  "你是一位擅长把零散语音笔记整理成结构化知识的中文助理。",
  "用户会给你若干段语音转写文本，它们可能口语化、有重复、有错别字、有断句错误。",
  "",
  "请把它们合并理解，输出一份结构化笔记。要求：",
  "1. 只输出一个 JSON 对象，不要输出任何解释文字，不要加 markdown 代码围栏。",
  '2. JSON 结构严格为：{"coreIdeas": string[], "todos": string[], "suggestions": string[]}',
  "3. coreIdeas：3-6 条核心想法，每条一句话，尽量保留用户原意和关键细节。",
  "4. todos：可执行的待办，每条以动词开头；原文里没有就返回空数组。",
  "5. suggestions：2-4 条基于内容的建议或下一步思路。",
  "6. 全部使用简体中文，不要编造原文中没有的事实。",
].join("\n");

export interface ParsedSummary {
  coreIdeas: string[];
  todos: string[];
  suggestions: string[];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

/** 模型有时会包一层 ```json 或加前后缀，这里截出第一个 { 到最后一个 } */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

export function parseSummaryContent(content: string): ParsedSummary {
  const empty: ParsedSummary = { coreIdeas: [], todos: [], suggestions: [] };
  const candidate = extractJsonObject(content);
  if (!candidate) {
    return empty;
  }
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed !== "object" || parsed === null) {
      return empty;
    }
    const record = parsed as Record<string, unknown>;
    return {
      coreIdeas: toStringArray(record.coreIdeas),
      todos: toStringArray(record.todos),
      suggestions: toStringArray(record.suggestions),
    };
  } catch {
    return empty;
  }
}

function buildUserPrompt(recordings: Recording[]): string {
  const parts: string[] = [];
  let used = 0;
  let truncated = false;

  for (const [index, recording] of recordings.entries()) {
    if (used >= MAX_PROMPT_CHARS) {
      truncated = true;
      break;
    }
    const body = recording.transcript.trim();
    const remaining = MAX_PROMPT_CHARS - used;
    const slice = body.length > remaining ? body.slice(0, remaining) : body;
    used += slice.length;
    parts.push(`【第 ${index + 1} 段 · ${recording.fileName}】\n${slice}`);
  }

  if (truncated) {
    parts.push("（注：转写内容过长，后面部分已省略）");
  }

  return `下面是 ${recordings.length} 段语音转写，请提炼：\n\n${parts.join("\n\n")}`;
}

/** 收集所有可用于提炼的转写 */
export function collectTranscribed(recordings: Recording[]): Recording[] {
  return recordings.filter(
    (item) => item.status === "transcribed" && item.transcript.trim().length > 0,
  );
}

export async function generateSummary(
  settings: AISettings,
  recordings: Recording[],
): Promise<AISummary> {
  const sources = collectTranscribed(recordings);
  if (sources.length === 0) {
    throw new Error("还没有已转写的文字，先转写几段再提炼。");
  }

  const result = await callChatCompletion(
    settings,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(sources) },
    ],
    { temperature: 0.3 },
  );

  return {
    ...parseSummaryContent(result.content),
    raw: result.content,
    model: result.model,
    sourceCount: sources.length,
    createdAt: Date.now(),
  };
}
