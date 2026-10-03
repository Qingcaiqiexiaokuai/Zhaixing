import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "../lib/audio";

export interface RecordButtonProps {
  /** 录完的音频，走和拖拽上传完全相同的入口 */
  onRecorded: (file: File) => void;
  className?: string;
}

type RecorderStatus = "idle" | "requesting" | "recording" | "error";

interface RecorderErrorInfo {
  title: string;
  hint: string;
}

/**
 * 优先 mp4（iOS Safari 只认这个），不支持再退到 webm/opus。
 * 返回 null 表示一个都不支持，那就交给浏览器自己挑默认格式。
 */
const MIME_CANDIDATES = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  return "webm";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 录音没有文件名，用当前时间生成一个；扩展名跟着实际编码格式走 */
function buildRecordingFile(blob: Blob, mimeType: string): File {
  const now = new Date();
  const stamp = [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  ].join(" ");
  return new File([blob], `录音 ${stamp}.${extensionFor(mimeType)}`, {
    type: mimeType,
    lastModified: now.getTime(),
  });
}

/** 把 getUserMedia / MediaRecorder 的各种失败翻译成人话 */
function describeRecorderError(error: unknown): RecorderErrorInfo {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "没有拿到麦克风权限",
        hint: "浏览器把这次录音的麦克风权限拒了。点地址栏左边的锁图标，把「麦克风」改成「允许」，再点一次开始录音。",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "没找到可用的麦克风",
        hint: "这台设备上似乎没有麦克风。插上带麦的耳机，或换个设备再试。",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "麦克风被别的程序占用了",
        hint: "先关掉正在用麦的会议/录音软件（或者别的标签页），再点一次。",
      };
    case "OverconstrainedError":
      return {
        title: "当前麦克风不支持这些参数",
        hint: "换一个输入设备再试一次。",
      };
    default:
      return {
        title: "录音没能启动",
        hint:
          error instanceof Error && error.message.length > 0
            ? error.message
            : "未知原因，稍后再试一次。",
      };
  }
}

function MicIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/**
 * 网页直接录音：MediaRecorder + getUserMedia。
 * 录完交给 onRecorded，之后的流程和拖拽上传完全一样（存 IndexedDB → Whisper 转写）。
 */
export function RecordButton({ onRecorded, className }: RecordButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<RecorderErrorInfo | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  /** false = 这次录音的结果别往外送（组件卸载 / 出错中断） */
  const deliverRef = useRef(true);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 把麦克风还回去：不停掉轨道的话浏览器会一直显示「正在使用麦克风」 */
  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      return;
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  // 卸载（关页面 / 热更新）时兜底：停表、停轨道、丢弃这次录音
  useEffect(() => {
    return () => {
      deliverRef.current = false;
      clearTimer();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      releaseStream();
    };
  }, [clearTimer, releaseStream]);

  const start = useCallback(async () => {
    setError(null);

    const mediaDevices: MediaDevices | undefined = navigator.mediaDevices;
    if (
      typeof MediaRecorder === "undefined" ||
      !mediaDevices ||
      typeof mediaDevices.getUserMedia !== "function"
    ) {
      setStatus("error");
      setError({
        title: "这个浏览器不支持网页录音",
        hint: "需要 MediaRecorder + getUserMedia，并且页面必须是 https 或 localhost。换 Chrome / Edge / Safari 新版试试。",
      });
      return;
    }

    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (permissionError) {
      setStatus("error");
      setError(describeRecorderError(permissionError));
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMimeType();

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (createError) {
      releaseStream();
      setStatus("error");
      setError(describeRecorderError(createError));
      return;
    }

    chunksRef.current = [];
    deliverRef.current = true;
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = (event: ErrorEvent) => {
      deliverRef.current = false;
      clearTimer();
      releaseStream();
      recorderRef.current = null;
      setStatus("error");
      setError({
        title: "录音中断了",
        hint:
          event.message.length > 0
            ? event.message
            : "浏览器中断了这次录音，再点一次开始录音。",
      });
    };

    recorder.onstop = () => {
      clearTimer();
      releaseStream();
      recorderRef.current = null;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      setStatus("idle");
      setSeconds(0);

      if (!deliverRef.current || chunks.length === 0) {
        return;
      }
      const type = recorder.mimeType || mimeType || "audio/webm";
      onRecordedRef.current(buildRecordingFile(new Blob(chunks, { type }), type));
    };

    try {
      // 每秒切一段：长录音不会把所有数据堆到最后一次 dataavailable
      recorder.start(1000);
    } catch (startError) {
      recorderRef.current = null;
      releaseStream();
      setStatus("error");
      setError(describeRecorderError(startError));
      return;
    }

    setSeconds(0);
    setStatus("recording");
    timerRef.current = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
  }, [clearTimer, releaseStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    deliverRef.current = true;
    recorder.stop();
  }, []);

  const toggle = () => {
    if (status === "recording") {
      stop();
      return;
    }
    if (status === "requesting") {
      return;
    }
    void start();
  };

  const isRecording = status === "recording";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={status === "requesting"}
          aria-pressed={isRecording}
          aria-label={isRecording ? "停止录音" : "开始录音"}
          className={`inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-medium text-white shadow-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 ${
            isRecording
              ? "bg-rose-600 ring-1 ring-rose-500/40 hover:bg-rose-700 focus-visible:ring-rose-500/50"
              : "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500/40"
          }`}
        >
          {isRecording ? (
            <span className="relative flex h-4 w-4 items-center justify-center">
              <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-white/40" />
              <span className="relative h-3 w-3 rounded-[3px] bg-white" />
            </span>
          ) : (
            <MicIcon />
          )}
          {status === "requesting"
            ? "正在请求麦克风…"
            : isRecording
              ? `录音中 (${formatDuration(seconds)})`
              : "开始录音"}
        </button>

        {isRecording ? (
          <span className="text-xs text-slate-500">
            再次点击停止，停止后自动开始转写
          </span>
        ) : (
          <span className="hidden text-xs text-slate-400 sm:inline">
            手机上没有音频文件时，直接对着网页说
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0 text-amber-600"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900">{error.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-amber-800">{error.hint}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStatus("idle");
            }}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            知道了
          </button>
        </div>
      ) : null}
    </div>
  );
}
