import type { TranscribeLanguage, TranscriptionModelId } from "../types";

export interface TranscriptionModelPreset {
  id: TranscriptionModelId;
  label: string;
  /** WebGPU 走 fp16，实测下载体积（MB） */
  webgpuSizeMb: number;
  /** 降级 wasm 走 q8，实测下载体积（MB） */
  wasmSizeMb: number;
  description: string;
}

export interface TranscribeLanguagePreset {
  id: TranscribeLanguage;
  label: string;
  /**
   * 实际传给 Whisper 的语种名。这里永远有值：
   * transformers.js v4 在 language 缺省时会 warn 并「默认英文」，中文音频会被解码成
   * 英文（看起来就像走了 translate），所以连「自动」也必须给一个明确兜底。
   */
  whisperName: string;
  /** Whisper 语种 token 用的两字母代码，如 <|zh|> / <|en|> */
  whisperCode: string;
  description: string;
}

export const TRANSCRIPTION_MODELS: readonly TranscriptionModelPreset[] = [
  {
    id: "onnx-community/whisper-tiny",
    label: "Whisper Tiny",
    webgpuSizeMb: 72.6,
    wasmSizeMb: 39,
    description: "最快，中文准确率一般",
  },
  {
    id: "onnx-community/whisper-base",
    label: "Whisper Base",
    webgpuSizeMb: 139.3,
    wasmSizeMb: 73.3,
    description: "速度和准确率平衡，推荐",
  },
  {
    id: "onnx-community/whisper-small",
    label: "Whisper Small",
    webgpuSizeMb: 462.7,
    wasmSizeMb: 237.5,
    description: "中文更准，但更慢、更吃显存",
  },
];

export const TRANSCRIBE_LANGUAGES: readonly TranscribeLanguagePreset[] = [
  {
    id: "chinese",
    label: "中文",
    whisperName: "chinese",
    whisperCode: "zh",
    description: "强制按中文转写，不会输出英文",
  },
  {
    id: "english",
    label: "英文",
    whisperName: "english",
    whisperCode: "en",
    description: "强制按英文转写",
  },
  {
    id: "auto",
    label: "自动",
    // transformers.js v4 里 language 缺省不是「自动识别」，而是 warn + 默认英文：
    // Whisper 会带着 <|en|><|transcribe|> 解码，中文音频就变成了英文译文。
    // 想真正自动识别得自己做一次语言检测，这里先兜底成中文，绝不留空。
    whisperName: "chinese",
    whisperCode: "zh",
    description: "不指定语种时 v4 会默认按英文解码（中文会被译成英文），所以兜底为中文",
  },
];

/**
 * 默认的初始提示词（initial_prompt）。
 * Whisper 会把它当成「上一段录音的上下文」来偏向同音词：把领域和常见词形写清楚，
 * 能明显减少「网址 → 王子」这类同音错词。
 */
export const DEFAULT_TRANSCRIBE_PROMPT =
  "以下是一段关于互联网、产品、开发、日常生活的录音，可能包含网址、App、代码等词汇。";

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
  "onnx-community/whisper-base";

export const DEFAULT_TRANSCRIBE_LANGUAGE: TranscribeLanguage = "chinese";

export function getTranscriptionModelPreset(
  id: TranscriptionModelId,
): TranscriptionModelPreset {
  return (
    TRANSCRIPTION_MODELS.find((item) => item.id === id) ??
    TRANSCRIPTION_MODELS[1]
  );
}

export function getTranscribeLanguagePreset(
  id: TranscribeLanguage,
): TranscribeLanguagePreset {
  return (
    TRANSCRIBE_LANGUAGES.find((item) => item.id === id) ??
    TRANSCRIBE_LANGUAGES[0]
  );
}

/** 取出实际传给 Whisper 的语种名。返回值一定是非空字符串（缺省会被 v4 当成英文）。 */
export function getWhisperLanguageName(id: TranscribeLanguage): string {
  return getTranscribeLanguagePreset(id).whisperName;
}

/** 取 Whisper 语种 token 用的两字母代码（zh / en），用来拼 <|zh|> */
export function getWhisperLanguageCode(id: TranscribeLanguage): string {
  return getTranscribeLanguagePreset(id).whisperCode;
}

export function isTranscriptionModelId(
  value: unknown,
): value is TranscriptionModelId {
  return TRANSCRIPTION_MODELS.some((item) => item.id === value);
}

export function isTranscribeLanguage(
  value: unknown,
): value is TranscribeLanguage {
  return TRANSCRIBE_LANGUAGES.some((item) => item.id === value);
}

/** 「约 139 MB（WebGPU）/ 73 MB（纯 CPU）」 */
export function formatModelSize(preset: TranscriptionModelPreset): string {
  return `约 ${Math.round(preset.webgpuSizeMb)} MB（WebGPU）/ ${Math.round(
    preset.wasmSizeMb,
  )} MB（纯 CPU）`;
}
