import type {
  AIProviderId,
  AISettings,
  CorrectionRule,
  ReasoningIdentityId,
  ReasoningModelId,
  TranscribeLanguage,
  TranscriptionModelId,
} from "../types";
import {
  DEFAULT_TRANSCRIBE_LANGUAGE,
  DEFAULT_TRANSCRIBE_PROMPT,
  DEFAULT_TRANSCRIPTION_MODEL,
  isTranscribeLanguage,
  isTranscriptionModelId,
} from "./transcription";

const STORAGE_KEY = "inspiration-vault:ai-settings";

export interface AIProviderPreset {
  id: AIProviderId;
  label: string;
  /** 浏览器实际请求的前缀，由 vite.config.ts 代理到真实服务 */
  proxyPath: string;
  defaultModel: string;
  hint: string;
}

export interface IdentityPreset {
  id: ReasoningIdentityId;
  label: string;
  /** 会拼进 system prompt 的身份视角 */
  persona: string;
  description: string;
}

export interface ReasoningModelPreset {
  id: ReasoningModelId;
  label: string;
  /** 会拼进 system prompt 的思维框架说明 */
  instruction: string;
  description: string;
}

export const AI_PROVIDERS: readonly AIProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    proxyPath: "/api/deepseek",
    defaultModel: "deepseek-chat",
    hint: "在 platform.deepseek.com 申请，形如 sk-xxxxxxxx",
  },
  {
    id: "openai",
    label: "OpenAI",
    proxyPath: "/api/openai",
    defaultModel: "gpt-4o-mini",
    hint: "在 platform.openai.com 申请，形如 sk-xxxxxxxx",
  },
  {
    id: "custom",
    label: "自定义",
    proxyPath: "/api/custom",
    defaultModel: "deepseek-chat",
    hint: "任意 OpenAI 兼容服务；需先在 vite.config.ts 里把 /api/custom 的 target 改成你的地址",
  },
];

export const IDENTITY_PRESETS: readonly IdentityPreset[] = [
  {
    id: "founder",
    label: "创业者",
    persona: "连续创业者，关注商业模式、增长杠杆、现金流、竞争壁垒与退出路径",
    description: "看商业模式与增长杠杆",
  },
  {
    id: "developer",
    label: "开发者",
    persona: "资深工程师，关注技术可行性、实现成本、可维护性、边界条件与长期债",
    description: "看技术可行性与实现成本",
  },
  {
    id: "pm",
    label: "产品经理",
    persona: "资深产品经理，关注用户真实价值、使用场景、优先级排序与可验证指标",
    description: "看用户价值与优先级",
  },
  {
    id: "creator",
    label: "内容创作者",
    persona: "全职内容创作者，关注选题角度、传播动机、受众共鸣与可持续产出节奏",
    description: "看选题角度与传播性",
  },
];

export const REASONING_MODEL_PRESETS: readonly ReasoningModelPreset[] = [
  {
    id: "first-principles",
    label: "第一性原理",
    instruction:
      "运用【第一性原理】：先剥离所有类比、惯例和「别人都这么做」，把问题拆到不可再分的基本事实，再从这些事实重新推导应该怎么做。明确指出哪些是被你剔除掉的、未经检验的假设。",
    description: "回到根本事实重新推导",
  },
  {
    id: "swot",
    label: "SWOT 分析",
    instruction:
      "运用【SWOT 分析】：分别列出优势(S)、劣势(W)、机会(O)、威胁(T)，每一项都要具体到事实而非形容词；然后给出 SO / WO / ST / WT 四组交叉策略，说明优先做哪一组。",
    description: "优势劣势机会威胁 + 交叉策略",
  },
  {
    id: "inversion",
    label: "反向思维",
    instruction:
      "运用【反向思维】：先假设这件事在一年后彻底失败，列举导致失败的具体原因（越具体越好）；再反过来推导：要避免什么、必须做什么、哪个信号出现就该立刻止损。",
    description: "先假设失败再倒推",
  },
  {
    id: "munger",
    label: "查理·芒格",
    instruction:
      "运用【查理·芒格的多元思维模型】：至少从激励结构（谁因此获益）、人类误判心理（哪些认知偏误在起作用）、复利与规模效应、机会成本、能力圈边界这五个角度交叉审视，指出最可能被忽略的那个盲点。",
    description: "多元思维模型交叉审视",
  },
  {
    id: "risk",
    label: "致命风险预警",
    instruction:
      "聚焦【致命风险预警】：找出最可能让这件事彻底死掉的一到三个致命问题，对每个问题评估「发生概率」和「一旦发生的后果」；然后给出可执行的验证动作和明确的止损线。不要罗列无关紧要的小风险。",
    description: "只找会致命的那几个问题",
  },
];

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: "deepseek",
  apiKey: "",
  model: "deepseek-chat",
  identity: "founder",
  reasoningModel: "first-principles",
  transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  transcribeLanguage: DEFAULT_TRANSCRIBE_LANGUAGE,
  transcribePrompt: DEFAULT_TRANSCRIBE_PROMPT,
  corrections: [],
};

function isProviderId(value: unknown): value is AIProviderId {
  return value === "deepseek" || value === "openai" || value === "custom";
}

export function getProviderPreset(id: AIProviderId): AIProviderPreset {
  return AI_PROVIDERS.find((item) => item.id === id) ?? AI_PROVIDERS[0];
}

export function getIdentityPreset(id: ReasoningIdentityId): IdentityPreset {
  return IDENTITY_PRESETS.find((item) => item.id === id) ?? IDENTITY_PRESETS[0];
}

export function getReasoningModelPreset(
  id: ReasoningModelId,
): ReasoningModelPreset {
  return (
    REASONING_MODEL_PRESETS.find((item) => item.id === id) ??
    REASONING_MODEL_PRESETS[0]
  );
}

function isIdentityId(value: unknown): value is ReasoningIdentityId {
  return IDENTITY_PRESETS.some((item) => item.id === value);
}

function isReasoningModelId(value: unknown): value is ReasoningModelId {
  return REASONING_MODEL_PRESETS.some((item) => item.id === value);
}

export function loadAISettings(): AISettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_AI_SETTINGS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_AI_SETTINGS };
    }
    const record = parsed as Record<string, unknown>;
    const provider = isProviderId(record.provider)
      ? record.provider
      : DEFAULT_AI_SETTINGS.provider;
    const model =
      typeof record.model === "string" && record.model.trim().length > 0
        ? record.model.trim()
        : getProviderPreset(provider).defaultModel;
    const transcriptionModel: TranscriptionModelId = isTranscriptionModelId(
      record.transcriptionModel,
    )
      ? record.transcriptionModel
      : DEFAULT_TRANSCRIPTION_MODEL;
    const transcribeLanguage: TranscribeLanguage = isTranscribeLanguage(
      record.transcribeLanguage,
    )
      ? record.transcribeLanguage
      : DEFAULT_TRANSCRIBE_LANGUAGE;
    return {
      provider,
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      model,
      identity: isIdentityId(record.identity)
        ? record.identity
        : DEFAULT_AI_SETTINGS.identity,
      reasoningModel: isReasoningModelId(record.reasoningModel)
        ? record.reasoningModel
        : DEFAULT_AI_SETTINGS.reasoningModel,
      transcriptionModel,
      transcribeLanguage,
      transcribePrompt:
        typeof record.transcribePrompt === "string"
          ? record.transcribePrompt
          : DEFAULT_TRANSCRIBE_PROMPT,
      corrections: readCorrections(record.corrections),
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAISettings(settings: AISettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage 不可用时静默忽略：设置依然保存在内存里，只是刷新后丢失
  }
}

/** 从 localStorage 读回来的原始值里解析纠错规则，兼容「多行文本」和「数组」两种历史形态 */
function readCorrections(value: unknown): CorrectionRule[] {
  if (typeof value === "string") {
    return parseCorrections(value);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: CorrectionRule[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const from = typeof record.from === "string" ? record.from.trim() : "";
    const to = typeof record.to === "string" ? record.to.trim() : "";
    if (from.length === 0 || from === to || seen.has(from)) {
      continue;
    }
    seen.add(from);
    rules.push({ from, to });
  }
  return rules;
}

/**
 * 「错误词 -> 正确词」多行文本 → 规则数组。
 * 支持 -> / => / → 三种箭头；# 开头的行是注释；右边留空表示把这个词删掉。
 */
export function parseCorrections(text: string): CorrectionRule[] {
  const rules: CorrectionRule[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const match = /^(.*?)\s*(?:->|=>|→)\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const from = match[1].trim();
    const to = match[2].trim();
    if (from.length === 0 || from === to || seen.has(from)) {
      continue;
    }
    seen.add(from);
    rules.push({ from, to });
  }
  return rules;
}

/** 规则数组 → 多行文本，填回设置面板的 textarea */
export function formatCorrections(rules: readonly CorrectionRule[]): string {
  return rules.map((rule) => `${rule.from} -> ${rule.to}`).join("\n");
}

/**
 * 把纠错规则套用到转写文字上。
 * 用 split/join 做纯字面量替换（不走正则，用户输入的括号、点号都不会变成元字符），
 * 长词优先，避免「网址」被更短的规则先吃掉。
 */
export function applyCorrections(
  text: string,
  rules: readonly CorrectionRule[],
): string {
  if (text.length === 0 || rules.length === 0) {
    return text;
  }
  const ordered = [...rules]
    .filter((rule) => rule.from.length > 0 && rule.from !== rule.to)
    .sort((a, b) => b.from.length - a.from.length);
  let result = text;
  for (const rule of ordered) {
    if (!result.includes(rule.from)) {
      continue;
    }
    result = result.split(rule.from).join(rule.to);
  }
  return result;
}

export function hasUsableApiKey(settings: AISettings): boolean {
  return settings.apiKey.trim().length > 0;
}
