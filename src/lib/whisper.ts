import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
import type {
  ModelLoadProgress,
  TranscribeLanguage,
  TranscriptionModelId,
} from "../types";
import {
  getWhisperLanguageCode,
  getWhisperLanguageName,
} from "./transcription";

env.allowLocalModels = false;
env.useBrowserCache = true;
// 走 Vite 开发服务器上的 /hf 反向代理（见 vite.config.ts），由 Node 侧去访问
// hf-mirror.com。浏览器只请求同源的 localhost，绕开 CORS / COEP 限制。
env.remoteHost = window.location.origin + "/hf";
env.remotePathTemplate = "{model}/resolve/{revision}/";

// ONNX Runtime 的 wasm 运行时默认从 cdn.jsdelivr.net 拉取（硬编码在
// transformers.js 的 src/backends/onnx.js），国内访问不稳定。这里改成走项目自己的
// public/ort/ 目录，文件与 node_modules/onnxruntime-web 的版本完全一致。
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs",
    wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm",
  };
}

type DeviceKind = "webgpu" | "wasm";

/**
 * 已加载的 pipeline 会被缓存，但换模型时必须重建（否则会拿旧模型转写）。
 * 浏览器的 Cache Storage 按 URL 缓存模型文件，所以切回用过的模型不会重新下载。
 */
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null =
  null;
let loadedModelId: TranscriptionModelId | null = null;
let activeDevice: DeviceKind | null = null;

/**
 * 清理被污染的缓存条目。
 *
 * 背景：Vite 的 SPA fallback 对任何未知路径都返回 `200 + index.html`，而
 * transformers.js 无论是读模型文件还是读 onnxruntime 的 wasm，都只看
 * `response.status === 200` / `cache.match()` 命中就把内容写进 Cache Storage
 * （env.cacheKey 默认是 "transformers-cache"），完全不校验 content-type。
 * 于是只要有一次请求落到了 fallback 上，这份 HTML 就会被永久缓存，
 * 之后一直读到它，报 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
 * 或者 wasm 实例化失败。这里按 content-type 把这些条目删掉。
 */
async function purgePoisonedCache(): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  try {
    const cache = await caches.open(env.cacheKey);
    let purged = 0;
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      const contentType = response?.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        await cache.delete(request);
        purged += 1;
      }
    }
    if (purged > 0) {
      console.warn(`[whisper] 已清除 ${purged} 条损坏的缓存，将重新下载`);
    }
  } catch (error) {
    console.warn("[whisper] 清理缓存失败（已忽略）", error);
  }
}

function toLoadProgress(info: ProgressInfo): ModelLoadProgress {
  if (info.status === "progress_total") {
    return {
      status: info.status,
      file: info.name,
      progress: info.progress,
    };
  }
  if (info.status === "progress") {
    return {
      status: info.status,
      file: info.file,
      progress: info.progress,
    };
  }
  if (info.status === "ready") {
    return {
      status: info.status,
      file: info.model,
      progress: 100,
    };
  }
  return {
    status: info.status,
    file: "file" in info ? info.file : "",
    progress: info.status === "done" ? 100 : 0,
  };
}

function extractTranscriptText(
  output: AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[],
): string {
  if (Array.isArray(output)) {
    return output
      .map((item) => item.text.trim())
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return output.text.trim();
}

async function createPipeline(
  modelId: TranscriptionModelId,
  device: DeviceKind,
  onProgress: (progress: ModelLoadProgress) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const dtype = device === "webgpu" ? "fp16" : "q8";
  return pipeline("automatic-speech-recognition", modelId, {
    device,
    dtype,
    progress_callback: (info: ProgressInfo) => {
      onProgress(toLoadProgress(info));
    },
  });
}

export function getActiveDevice(): DeviceKind | null {
  return activeDevice;
}

export function getLoadedModelId(): TranscriptionModelId | null {
  return loadedModelId;
}

export async function getTranscriber(
  modelId: TranscriptionModelId,
  onProgress: (progress: ModelLoadProgress) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise || loadedModelId !== modelId) {
    loadedModelId = modelId;
    activeDevice = null;
    transcriberPromise = (async () => {
      // 先清掉历史遗留的 HTML 缓存，否则会一直报 JSON / wasm 相关错误
      await purgePoisonedCache();
      try {
        const pipelineInstance = await createPipeline(
          modelId,
          "webgpu",
          onProgress,
        );
        activeDevice = "webgpu";
        return pipelineInstance;
      } catch (webgpuError) {
        console.warn("WebGPU 不可用，降级到 wasm", webgpuError);
        const pipelineInstance = await createPipeline(
          modelId,
          "wasm",
          onProgress,
        );
        activeDevice = "wasm";
        return pipelineInstance;
      }
    })().catch((error: unknown) => {
      transcriberPromise = null;
      loadedModelId = null;
      activeDevice = null;
      throw error;
    });
  }
  return transcriberPromise;
}

export interface TranscribeOptions {
  modelId: TranscriptionModelId;
  language: TranscribeLanguage;
  /** 初始提示词（initial_prompt）：先把这批录音的领域／常见词喂给 Whisper，偏向同音词 */
  prompt?: string;
}

/**
 * ASR pipeline 的调用参数。
 * decoder_input_ids 在库的类型里有（GenerationFunctionParameters），initial_prompt 没有，
 * 所以这里显式补一个字段，免得用 as 强转。
 */
type WhisperCallOptions = {
  chunk_length_s?: number;
  stride_length_s?: number;
  language?: string;
  task?: string;
  decoder_input_ids?: number[];
  initial_prompt?: string;
};

/**
 * 把 initial_prompt 变成真正生效的 decoder_input_ids。
 *
 * transformers.js 4.3.0 的 JS 实现并不认 initial_prompt / prompt_ids：
 * WhisperGenerationConfig 上虽然有 prompt_ids 字段，但 _retrieve_init_tokens()
 * 从没用过它（只拼 decoder_start / language / task / notimestamps），而 generate()
 * 里唯一能绕开 _retrieve_init_tokens 的入口就是 decoder_input_ids。
 * 所以这里手工拼 Whisper 官方的「上一段上下文」前缀：
 *
 *   <|startoftranscript|> <|zh|> <|transcribe|> <|startofprev|> …提示词 token… <|startoftranscript|> <|notimestamps|>
 *
 * 任何一个特殊 token 在词表里找不到，就返回 null，退回「不带提示词」的正常路径，
 * 不会因为提示词把整段转写搞坏。
 */
function buildPromptDecoderInputIds(
  transcriber: AutomaticSpeechRecognitionPipeline,
  languageCode: string,
  prompt: string,
): number[] | null {
  const text = prompt.trim();
  if (text.length === 0) {
    return null;
  }
  try {
    const tokenizer = transcriber.tokenizer;
    const vocab = tokenizer.get_vocab();
    const tokenId = (token: string): number | null => {
      if (!vocab.has(token)) {
        return null;
      }
      const id = tokenizer.convert_tokens_to_ids(token);
      return Number.isInteger(id) && id >= 0 ? id : null;
    };

    const startOfTranscript = tokenId("<|startoftranscript|>");
    const startOfPrev = tokenId("<|startofprev|>");
    const noTimestamps = tokenId("<|notimestamps|>");
    const languageToken = tokenId(`<|${languageCode}|>`);
    const taskToken = tokenId("<|transcribe|>");
    if (
      startOfTranscript === null ||
      startOfPrev === null ||
      noTimestamps === null ||
      languageToken === null ||
      taskToken === null
    ) {
      return null;
    }

    const promptIds = tokenizer
      .encode(text, { add_special_tokens: false })
      .filter((id) => Number.isInteger(id) && id >= 0);
    if (promptIds.length === 0) {
      return null;
    }

    return [
      startOfTranscript,
      languageToken,
      taskToken,
      startOfPrev,
      ...promptIds,
      startOfTranscript,
      noTimestamps,
    ];
  } catch (error) {
    console.warn("[whisper] 初始提示词拼 token 失败，本次转写不带提示词", error);
    return null;
  }
}

/**
 * Whisper 的解码任务。
 *
 * 这里刻意用字面量类型锁死成只能是 "transcribe"：只要谁写下 task: "translate"，
 * 编译期就会报错，中文被翻译成英文的 bug 从类型层面就写不出来。
 */
export type WhisperDecoderTask = "transcribe";

export const WHISPER_DECODER_TASK = "transcribe" satisfies WhisperDecoderTask;

export async function transcribeBlob(
  blob: Blob,
  options: TranscribeOptions,
): Promise<string> {
  const transcriber = await getTranscriber(options.modelId, () => undefined);
  const objectUrl = URL.createObjectURL(blob);
  try {
    // 注意：language / task 必须作为「调用参数」传给 transcriber，
    // 而不是传给 pipeline()。transformers.js 的 ASR pipeline 会把 kwargs 原样
    // 塞进 model.generate()，Whisper 正是在 generate 里根据 language / task
    // 决定解码起始 token 的。传给 pipeline() 不会生效。
    //
    // 两个都会踩的坑：
    // 1. task 缺省时 v4 的 WhisperGenerationConfig 是 null 落成 "transcribe"，
    //    但显式传一遍最稳（也是唯一能让人一眼看出没走 translate 的地方）；
    // 2. language 缺省时 v4 不是自动识别，而是 warn + 默认英文（<|en|>），
    //    中文音频会被解码成英文译文，所以这里永远传一个明确语种。
    const language = getWhisperLanguageName(options.language);
    const prompt = options.prompt?.trim() ?? "";
    const decoderInputIds =
      prompt.length > 0
        ? buildPromptDecoderInputIds(
            transcriber,
            getWhisperLanguageCode(options.language),
            prompt,
          )
        : null;
    if (prompt.length > 0 && decoderInputIds === null) {
      console.warn(
        "[whisper] 当前模型词表里没有 <|startofprev|> 等特殊 token，本次转写不带初始提示词",
      );
    }

    const callOptions: WhisperCallOptions = {
      chunk_length_s: 30,
      stride_length_s: 5,
      task: WHISPER_DECODER_TASK,
      language,
      ...(decoderInputIds
        ? {
            // 4.3.0 会把它丢掉，显式留着是为了以后库支持 initial_prompt 时自动生效
            initial_prompt: prompt,
            decoder_input_ids: decoderInputIds,
          }
        : {}),
    };
    const output = await transcriber(objectUrl, callOptions);
    return extractTranscriptText(output);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
