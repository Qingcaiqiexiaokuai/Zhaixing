import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type { Recording } from "../types";
import { formatDuration, formatFileSize } from "../lib/audio";
import { formatDateTime } from "../lib/markdown";
import { AudioPlayer } from "./AudioPlayer";

interface RecordingListProps {
  recordings: Recording[];
  /** 正在转写的 id */
  activeId: string | null;
  /** 正在推演的 id */
  activeReasoningId: string | null;
  selectedIds: ReadonlySet<string>;
  /** 正在播放淡出动画、还没真正从数据里移除的 id */
  removingIds: ReadonlySet<string>;
  reasoningBusy: boolean;
  onToggleSelect: (id: string) => void;
  onReason: (id: string) => void;
  onViewResult: (id: string) => void;
  onRequestDelete: (id: string) => void;
  /** 手动保存编辑后的转写文字；抛错时卡片内会显示错误 */
  onSaveTranscript: (id: string, transcript: string) => Promise<void>;
  /** 用当前模型和语种（重新）跑这一条的转写 */
  onRetranscribe: (id: string) => void;
  /** 转写批次运行时禁用「重新转写」 */
  transcribeBusy: boolean;
}

const TRANSCRIPT_PREVIEW_LIMIT = 160;
/** 左滑后露出的删除区宽度 */
const ACTION_WIDTH = 88;
/** 判定为横向滑动的最小位移 */
const SWIPE_THRESHOLD = 10;

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function PencilIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function RefreshIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
      <path d="M20.5 4v5h-5" />
    </svg>
  );
}

function TranscribeBadge({
  recording,
  isActive,
}: {
  recording: Recording;
  isActive: boolean;
}) {
  if (isActive) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        转写中
      </span>
    );
  }
  if (recording.status === "transcribed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 ring-inset">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        已转写
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 ring-inset">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      未处理
    </span>
  );
}

function ReasoningBadge({ recording }: { recording: Recording }) {
  switch (recording.reasoningStatus) {
    case "queued":
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 ring-inset">
          排队中
        </span>
      );
    case "thinking":
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          推演中
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 ring-inset">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m12 3 2.2 5.6L20 10.5l-4.5 3.8L16.8 20 12 17l-4.8 3 1.3-5.7L4 10.5l5.8-1.9z" />
          </svg>
          已推演
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 ring-inset">
          推演失败
        </span>
      );
    default:
      return null;
  }
}

/** 转写文字编辑器的完整状态，由 RecordingCard 持有（左滑手势要知道是否在编辑） */
interface TranscriptEditor {
  editing: boolean;
  draft: string;
  saving: boolean;
  error: string | null;
  start: () => void;
  cancel: () => void;
  save: () => void;
  updateDraft: (value: string) => void;
}

function useTranscriptEditor(
  recording: Recording,
  onSaveTranscript: (id: string, transcript: string) => Promise<void>,
): TranscriptEditor {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recording.transcript);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** draft 当前同步到的原始文字，用来发现外部更新 */
  const [syncedTranscript, setSyncedTranscript] = useState(recording.transcript);

  // 外部（重新转写 / 重新读库）更新了文字时，渲染期直接丢弃未保存的草稿
  if (!editing && syncedTranscript !== recording.transcript) {
    setSyncedTranscript(recording.transcript);
    setDraft(recording.transcript);
  }

  const start = useCallback(() => {
    setDraft(recording.transcript);
    setError(null);
    setEditing(true);
  }, [recording.transcript]);

  const cancel = useCallback(() => {
    setDraft(recording.transcript);
    setError(null);
    setEditing(false);
  }, [recording.transcript]);

  const save = useCallback(() => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    void onSaveTranscript(recording.id, draft)
      .then(() => {
        setEditing(false);
      })
      .catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : "保存失败");
      })
      .finally(() => {
        setSaving(false);
      });
  }, [draft, onSaveTranscript, recording.id, saving]);

  return {
    editing,
    draft,
    saving,
    error,
    start,
    cancel,
    save,
    updateDraft: setDraft,
  };
}

/** 转写文字区块：查看 / 展开 / 手动编辑（编辑态是 textarea + 保存 + 取消） */
function TranscriptSection({
  recording,
  editor,
  onRetranscribe,
  retranscribeDisabled,
}: {
  recording: Recording;
  editor: TranscriptEditor;
  onRetranscribe: () => void;
  retranscribeDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const transcript = recording.transcript.trim();
  const hasTranscript = transcript.length > 0;
  const isLong = transcript.length > TRANSCRIPT_PREVIEW_LIMIT;

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        editor.cancel();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        editor.save();
      }
    },
    [editor],
  );

  /** 编辑时手指落在 textarea 上不能触发卡片左滑 */
  const stopCardGesture = useCallback(
    (event: ReactTouchEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
    },
    [],
  );

  if (editor.editing) {
    return (
      <div className="mt-3">
        <textarea
          autoFocus
          value={editor.draft}
          onChange={(event) => editor.updateDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onTouchStart={stopCardGesture}
          onTouchMove={stopCardGesture}
          onTouchEnd={stopCardGesture}
          rows={Math.min(14, Math.max(4, editor.draft.split("\n").length + 1))}
          aria-label={`编辑 ${recording.fileName} 的转写文字`}
          className="w-full resize-y rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={editor.save}
            disabled={editor.saving}
            className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {editor.saving ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            onClick={editor.cancel}
            disabled={editor.saving}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <span className="text-xs text-slate-400">
            {editor.draft.length} 字 · Ctrl/⌘ + Enter 保存 · Esc 取消
          </span>
        </div>
        {editor.error ? (
          <p className="mt-2 text-xs text-rose-600" role="alert">
            {editor.error}
          </p>
        ) : null}
      </div>
    );
  }

  const visible =
    expanded || !isLong
      ? transcript
      : `${transcript.slice(0, TRANSCRIPT_PREVIEW_LIMIT)}…`;

  if (!hasTranscript) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">暂无转写文字</span>
        <button
          type="button"
          onClick={editor.start}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          <PencilIcon size={13} />
          手动录入
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm leading-6 whitespace-pre-wrap text-slate-700">
        {visible}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={editor.start}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          <PencilIcon size={13} />
          编辑
        </button>
        {recording.status === "transcribed" ? (
          <button
            type="button"
            onClick={onRetranscribe}
            disabled={retranscribeDisabled}
            title="用当前模型和语种重跑这一条，现有文字会被替换"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshIcon size={13} />
            重新转写
          </button>
        ) : null}
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
          >
            {expanded ? "收起" : "展开全文"}
          </button>
        ) : null}
        {recording.transcribedWith ? (
          <span className="text-xs text-slate-400">
            {recording.transcribedWith}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ReasoningSection({
  recording,
  reasoningBusy,
  onReason,
  onViewResult,
}: {
  recording: Recording;
  reasoningBusy: boolean;
  onReason: (id: string) => void;
  onViewResult: (id: string) => void;
}) {
  const { reasoningStatus, reasoning, reasoningError } = recording;

  if (reasoningStatus === "idle") {
    return null;
  }

  if (reasoningStatus === "queued" || reasoningStatus === "thinking") {
    return (
      <p className="mt-3 text-xs text-slate-500">
        {reasoningStatus === "queued"
          ? "已加入队列，等待推演…"
          : "AI 正在按你选的身份和思维模型推演…"}
      </p>
    );
  }

  if (reasoningStatus === "failed") {
    return (
      <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
        <p className="text-xs leading-5 text-rose-700">
          {reasoningError ?? "推演失败"}
        </p>
        <button
          type="button"
          onClick={() => onReason(recording.id)}
          disabled={reasoningBusy}
          className="mt-2 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          重试
        </button>
      </div>
    );
  }

  if (reasoningStatus === "completed" && reasoning) {
    const preview =
      reasoning.content.length > 120
        ? `${reasoning.content.slice(0, 120)}…`
        : reasoning.content;
    const chatCount = recording.chatHistory.filter(
      (message) => message.role !== "system" && message.content.trim().length > 0,
    ).length;
    return (
      <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
        <p className="text-xs font-medium text-blue-800">
          {reasoning.identityLabel} · {reasoning.modelLabel}
        </p>
        <p className="mt-1 line-clamp-3 text-xs leading-5 whitespace-pre-wrap text-slate-600">
          {preview}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onViewResult(recording.id)}
            className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            查看推演
          </button>
          {chatCount > 0 ? (
            <span className="text-xs text-slate-400">
              {chatCount} 条追问
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function RecordingCard({
  recording,
  isActive,
  isReasoning,
  selected,
  removing,
  reasoningBusy,
  onToggleSelect,
  onReason,
  onViewResult,
  onRequestDelete,
  onSaveTranscript,
  onRetranscribe,
  transcribeBusy,
}: {
  recording: Recording;
  isActive: boolean;
  isReasoning: boolean;
  selected: boolean;
  removing: boolean;
  reasoningBusy: boolean;
  onToggleSelect: (id: string) => void;
  onReason: (id: string) => void;
  onViewResult: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onSaveTranscript: (id: string, transcript: string) => Promise<void>;
  onRetranscribe: (id: string) => void;
  transcribeBusy: boolean;
}) {
  const [dragX, setDragX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(0);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    locked: boolean | null;
  } | null>(null);

  const editor = useTranscriptEditor(recording, onSaveTranscript);

  // 位移 = 已经露出的一半 + 当前手指拖动的距离，钳制在 [-ACTION_WIDTH, 0]
  const translate = Math.max(
    -ACTION_WIDTH,
    Math.min(0, (revealed ? -ACTION_WIDTH : 0) + dragX),
  );

  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    // 编辑中不做左滑，否则选中文字会被判定成滑动手势
    if (editor.editing) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      locked: null,
    };
    dragRef.current = 0;
    setDragX(0);
  };

  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (editor.editing) {
      return;
    }
    const gesture = gestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch) {
      return;
    }
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    // 还没判定方向：先看是横滑还是纵向滚动
    if (gesture.locked === null) {
      if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
        return;
      }
      gesture.locked = Math.abs(dx) > Math.abs(dy);
      if (!gesture.locked) {
        // 纵向滚动，交还给浏览器
        gestureRef.current = null;
        return;
      }
      setDragging(true);
    }

    dragRef.current = dx;
    setDragX(dx);
  };

  const onTouchEnd = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setDragging(false);
    if (!gesture || !gesture.locked) {
      setDragX(0);
      return;
    }
    const base = revealed ? -ACTION_WIDTH : 0;
    setRevealed(base + dragRef.current < -ACTION_WIDTH / 2);
    dragRef.current = 0;
    setDragX(0);
  };

  const canSelect =
    recording.status === "transcribed" &&
    recording.transcript.trim().length > 0;
  const canReason =
    canSelect &&
    (recording.reasoningStatus === "idle" ||
      recording.reasoningStatus === "failed");
  const inFlight =
    recording.reasoningStatus === "queued" ||
    recording.reasoningStatus === "thinking";

  return (
    <li
      className={`relative overflow-hidden rounded-2xl transition-all duration-300 ${
        removing
          ? "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
          : "translate-y-0 scale-100 opacity-100"
      }`}
    >
      {/* 左滑露出的删除按钮（手机端） */}
      <div className="absolute inset-y-0 right-0 w-[88px]">
        <button
          type="button"
          onClick={() => onRequestDelete(recording.id)}
          className="flex h-full w-full flex-col items-center justify-center gap-1 bg-rose-500 text-xs font-medium text-white transition-colors hover:bg-rose-600"
          aria-label={`删除 ${recording.fileName}`}
        >
          <TrashIcon size={17} />
          删除
        </button>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${translate}px)`,
          transition: dragging ? "none" : "transform 200ms ease",
        }}
        className={`group relative rounded-2xl border bg-white p-4 shadow-sm ${
          selected ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <input
              type="checkbox"
              checked={selected}
              disabled={!canSelect}
              onChange={() => onToggleSelect(recording.id)}
              aria-label={`选择 ${recording.fileName}`}
              className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3 sm:pr-16">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-slate-900">
                  {recording.fileName}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDuration(recording.duration)} ·{" "}
                  {formatFileSize(recording.size)} ·{" "}
                  {formatDateTime(recording.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <TranscribeBadge recording={recording} isActive={isActive} />
                <ReasoningBadge recording={recording} />
              </div>
            </div>

            {/* 原始音频：核对转写用 */}
            <div className="mt-3">
              <AudioPlayer
                audio={recording.audioBlob}
                mimeType={recording.mimeType}
                fallbackDuration={recording.duration}
                label={recording.fileName}
              />
            </div>

            <TranscriptSection
              recording={recording}
              editor={editor}
              onRetranscribe={() => onRetranscribe(recording.id)}
              retranscribeDisabled={transcribeBusy}
            />

            <ReasoningSection
              recording={recording}
              reasoningBusy={reasoningBusy}
              onReason={onReason}
              onViewResult={onViewResult}
            />

            {canReason && !inFlight ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onReason(recording.id)}
                  disabled={reasoningBusy}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  定向推演
                </button>
                {isReasoning ? (
                  <span className="text-xs text-amber-600">推演中…</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 电脑端：hover 卡片时右上角出现编辑 / 删除 */}
        <div className="absolute top-3 right-3 hidden items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 sm:flex">
          <button
            type="button"
            onClick={() => {
              setRevealed(false);
              editor.start();
            }}
            aria-label={`编辑 ${recording.fileName} 的转写文字`}
            title="编辑转写"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-400/40"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            onClick={() => onRequestDelete(recording.id)}
            aria-label={`删除 ${recording.fileName}`}
            title="删除"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-rose-400/40"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </li>
  );
}

export function RecordingList({
  recordings,
  activeId,
  activeReasoningId,
  selectedIds,
  removingIds,
  reasoningBusy,
  onToggleSelect,
  onReason,
  onViewResult,
  onRequestDelete,
  onSaveTranscript,
  onRetranscribe,
  transcribeBusy,
}: RecordingListProps) {
  if (recordings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center">
        <p className="text-sm text-slate-500">
          还没有音频。拖入或选择文件后会出现在这里。
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {recordings.map((recording) => (
        <RecordingCard
          key={recording.id}
          recording={recording}
          isActive={activeId === recording.id}
          isReasoning={activeReasoningId === recording.id}
          selected={selectedIds.has(recording.id)}
          removing={removingIds.has(recording.id)}
          reasoningBusy={reasoningBusy}
          onToggleSelect={onToggleSelect}
          onReason={onReason}
          onViewResult={onViewResult}
          onRequestDelete={onRequestDelete}
          onSaveTranscript={onSaveTranscript}
          onRetranscribe={onRetranscribe}
          transcribeBusy={transcribeBusy}
        />
      ))}
    </ul>
  );
}
