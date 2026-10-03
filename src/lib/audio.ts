import type { AudioPayload } from "../types";

const ACCEPTED_EXTENSIONS = [".m4a", ".mp3", ".wav", ".webm"] as const;

export const AUDIO_ACCEPT =
  ".m4a,.mp3,.wav,.webm,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/webm";

export const DEFAULT_AUDIO_MIME = "audio/webm";

/**
 * 把音频统一成 Blob，供 URL.createObjectURL / <audio> 使用。
 * - Blob（含 File）：直接返回，MIME 缺失时用兜底值补一个；
 * - ArrayBuffer / Uint8Array：包一层 Blob（老版本 IndexedDB 里存过这种形态）。
 */
export function toAudioBlob(
  source: AudioPayload,
  mimeType: string = DEFAULT_AUDIO_MIME,
): Blob {
  if (source instanceof Blob) {
    return source.type.length > 0
      ? source
      : new Blob([source], { type: mimeType });
  }
  const view = source instanceof Uint8Array ? source : new Uint8Array(source);
  const buffer = view.buffer;
  // 整个 buffer 正好被这个 view 覆盖时可以零拷贝直接包 Blob
  if (
    view.byteOffset === 0 &&
    view.byteLength === buffer.byteLength &&
    buffer instanceof ArrayBuffer
  ) {
    return new Blob([buffer], { type: mimeType });
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return new Blob([copy], { type: mimeType });
}

export function isAcceptedAudioFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function getAudioDuration(audio: AudioPayload): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("audio");
    const objectUrl = URL.createObjectURL(toAudioBlob(audio));
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = element.duration;
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    element.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取音频时长"));
    };
    element.src = objectUrl;
  });
}
