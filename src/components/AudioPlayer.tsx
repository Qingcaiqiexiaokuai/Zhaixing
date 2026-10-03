import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type { AudioPayload } from "../types";
import { DEFAULT_AUDIO_MIME, formatDuration, toAudioBlob } from "../lib/audio";

export interface AudioPlayerProps {
  /** IndexedDB 里的音频：新数据是 Blob，老数据可能是 ArrayBuffer / Uint8Array */
  audio: AudioPayload;
  /** 音频 MIME 类型，数组形态转 Blob 时用得上 */
  mimeType?: string;
  /** 库里记录的时长，元数据加载完成前先用它显示总时长 */
  fallbackDuration?: number;
  /** 无障碍标签，一般传文件名 */
  label?: string;
  className?: string;
}

/** 进度条拖动步进（秒） */
const SEEK_STEP_S = 0.1;

function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

/**
 * 录音卡片里的原始音频播放器。
 *
 * - 音频来源可能是 Blob 或 ArrayBuffer / Uint8Array，统一走 toAudioBlob；
 * - object URL 在 audio 变化 / 组件卸载时都会 revoke，不泄漏内存；
 * - 所有触摸与点击事件都 stopPropagation，避免触发卡片的左滑删除 / 选中逻辑。
 */
export function AudioPlayer({
  audio,
  mimeType = DEFAULT_AUDIO_MIME,
  fallbackDuration = 0,
  label,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 拖动进度条期间忽略 timeupdate，避免和手指打架 */
  const seekingRef = useRef(false);

  const blob = useMemo(() => toAudioBlob(audio, mimeType), [audio, mimeType]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [error, setError] = useState<string | null>(null);
  /** 当前播放状态对应的音频，用来发现「换了另一条音频」 */
  const [loadedBlob, setLoadedBlob] = useState(blob);

  // 建 URL -> 卸载 / 换音频时 revoke。切换卡片时 audio 变了，cleanup 先释放旧 URL。
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    // object URL 属于 React 之外的资源，只能先建好再交给 <audio>
    // oxlint-disable-next-line react/set-state-in-effect
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  // 换了一条音频：在渲染期直接把播放状态与进度归零（不用再跑一次 effect）
  if (loadedBlob !== blob) {
    setLoadedBlob(blob);
    setCurrentTime(0);
    setIsPlaying(false);
    setError(null);
    setDuration(fallbackDuration);
  }

  /** 卡片父级用 touch 做左滑删除，播放器上的手势不能冒泡出去 */
  const stopCardGesture = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const stopClick = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const element = audioRef.current;
    if (!element) {
      return;
    }
    if (Number.isFinite(element.duration)) {
      setDuration(element.duration);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const element = audioRef.current;
    if (!element || seekingRef.current) {
      return;
    }
    setCurrentTime(element.currentTime);
  }, []);

  const handleTogglePlay = useCallback(() => {
    const element = audioRef.current;
    if (!element) {
      return;
    }
    if (element.paused) {
      setError(null);
      void element.play().catch((playError: unknown) => {
        setIsPlaying(false);
        setError(
          playError instanceof Error ? playError.message : "这段音频无法播放",
        );
      });
    } else {
      element.pause();
    }
  }, []);

  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    const element = audioRef.current;
    setCurrentTime(next);
    if (element && Number.isFinite(next)) {
      element.currentTime = next;
    }
  }, []);

  const handleSeekStart = useCallback(() => {
    seekingRef.current = true;
  }, []);

  const handleSeekEnd = useCallback(() => {
    seekingRef.current = false;
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleError = useCallback(() => {
    setIsPlaying(false);
    setError("这段音频无法播放（格式可能不被浏览器支持）");
  }, []);

  const total = duration > 0 ? duration : fallbackDuration;
  const max = total > 0 ? total : 1;
  const totalText = total > 0 ? formatDuration(total) : "--:--";

  return (
    <div
      role="group"
      aria-label={label ? `${label} 音频播放器` : "音频播放器"}
      onClick={stopClick}
      onPointerDown={stopClick}
      onTouchStart={stopCardGesture}
      onTouchMove={stopCardGesture}
      onTouchEnd={stopCardGesture}
      onTouchCancel={stopCardGesture}
      className={`rounded-xl border border-slate-200 bg-white px-3 py-2 ${
        className ?? ""
      }`}
    >
      <audio
        ref={audioRef}
        src={objectUrl ?? undefined}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onError={handleError}
        className="hidden"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleTogglePlay();
          }}
          onTouchStart={(event) => {
            event.stopPropagation();
          }}
          disabled={objectUrl === null || error !== null}
          aria-label={isPlaying ? "暂停" : "播放"}
          title={isPlaying ? "暂停" : "播放"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <input
          type="range"
          min={0}
          max={max}
          step={SEEK_STEP_S}
          value={Math.min(currentTime, max)}
          onChange={handleSeek}
          onPointerDown={handleSeekStart}
          onPointerUp={handleSeekEnd}
          onTouchStart={(event) => {
            handleSeekStart();
            event.stopPropagation();
          }}
          onTouchEnd={(event) => {
            handleSeekEnd();
            event.stopPropagation();
          }}
          onTouchCancel={handleSeekEnd}
          disabled={total <= 0}
          aria-label="播放进度"
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
        />

        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
          {formatDuration(currentTime)} / {totalText}
        </span>
      </div>

      {error ? (
        <p className="mt-1.5 text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
