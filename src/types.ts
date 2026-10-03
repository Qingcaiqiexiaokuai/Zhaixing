export type RecordingStatus = "pending" | "transcribed";

/**
 * 定向推演的状态机。
 * idle -> queued -> thinking -> completed / failed
 */
export type ReasoningStatus =
  | "idle"
  | "queued"
  | "thinking"
  | "completed"
  | "failed";

/** 我的身份 */
export type ReasoningIdentityId = "founder" | "developer" | "pm" | "creator";

/** 推演思维模型 */
export type ReasoningModelId =
  | "first-principles"
  | "swot"
  | "inversion"
  | "munger"
  | "risk";

/** 转写语种。auto 表示让 Whisper 自己判断（v4 下会兜底成中文，见 lib/transcription.ts）。 */
export type TranscribeLanguage = "chinese" | "english" | "auto";

/** 音频来源：拖拽/选择文件，还是网页里直接录的音 */
export type RecordingSource = "upload" | "record";

/**
 * 音频数据的物理形态。
 * 新写入的记录统一是 Blob（File 本身也是 Blob）；老 IndexedDB 记录里可能存的是
 * ArrayBuffer / Uint8Array，读取时统一转成 Blob（见 lib/audio.ts 的 toAudioBlob）。
 */
export type AudioPayload = Blob | ArrayBuffer | Uint8Array;

/** 可选的 Whisper ONNX 模型 */
export type TranscriptionModelId =
  | "onnx-community/whisper-tiny"
  | "onnx-community/whisper-base"
  | "onnx-community/whisper-small";

export interface Recording {
  id: string;
  fileName: string;
  /** 这条音频是怎么来的；老数据读出来会被补成 upload */
  source: RecordingSource;
  mimeType: string;
  size: number;
  duration: number;
  audioBlob: Blob;
  transcript: string;
  status: RecordingStatus;
  createdAt: number;
  /** 定向推演状态，默认 idle。老数据读出来会被补成 idle。 */
  reasoningStatus: ReasoningStatus;
  /** 定向推演结果，未推演或失败时为 null */
  reasoning: ReasoningResult | null;
  /** 推演失败原因 */
  reasoningError: string | null;
  /** 转写时实际用的模型名与语种，方便事后追溯；老数据为 null */
  transcribedWith: string | null;
  /** 推演结果的后续多轮讨论；默认空数组，老数据读出来会补成 [] */
  chatHistory: ReasoningChatMessage[];
}

export interface ReasoningResult {
  identity: ReasoningIdentityId;
  model: ReasoningModelId;
  /** 推演时实际使用的身份名，快照下来防止以后改设置导致历史结果错位 */
  identityLabel: string;
  modelLabel: string;
  content: string;
  llmModel: string;
  createdAt: number;
}

/**
 * 推演后续「继续深度讨论」里的一条消息。
 * 结构与 OpenAI chat 一致；system 只在拼请求时内部使用，不会写进记录。
 */
export interface ReasoningChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** 写入时间，用于 UI 排序与显示；老数据可能没有 */
  createdAt?: number;
}

export interface ModelLoadProgress {
  status: string;
  file: string;
  progress: number;
}

export interface TranscribeProgress {
  current: number;
  total: number;
  recordingId: string;
  fileName: string;
}

/** AI 服务商标识。custom 走 vite.config.ts 里的 /api/custom 代理。 */
export type AIProviderId = "deepseek" | "openai" | "custom";

/** 自定义纠错：把转写里常见的同音错词替换成正确写法 */
export interface CorrectionRule {
  /** 命中词（错误写法） */
  from: string;
  /** 替换成什么；留空表示把命中的词直接删掉 */
  to: string;
}

/** BYOK + 转写偏好 + 推演偏好，持久化在 localStorage。 */
export interface AISettings {
  provider: AIProviderId;
  apiKey: string;
  model: string;
  /** 我的身份 */
  identity: ReasoningIdentityId;
  /** 推演思维模型 */
  reasoningModel: ReasoningModelId;
  /** 转写用哪个 Whisper 模型 */
  transcriptionModel: TranscriptionModelId;
  /** 转写语种 */
  transcribeLanguage: TranscribeLanguage;
  /** 送给 Whisper 的初始提示词（initial_prompt）；空字符串表示不传 */
  transcribePrompt: string;
  /** 转写完成后自动应用的替换规则（同音词纠错） */
  corrections: CorrectionRule[];
}

/** 「一键 AI 提炼」的结构化结果，持久化在 IndexedDB。 */
export interface AISummary {
  coreIdeas: string[];
  todos: string[];
  suggestions: string[];
  raw: string;
  model: string;
  sourceCount: number;
  createdAt: number;
}
