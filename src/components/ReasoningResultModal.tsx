import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ReasoningChatMessage, Recording } from "../types";
import { formatDateTime } from "../lib/markdown";
import { MarkdownBlock } from "./MarkdownBlock";

interface ReasoningResultModalProps {
  recording: Recording | null;
  /** 推演队列是否在跑：决定「重新推演」能不能点 */
  isBusy: boolean;
  /** 这条录音是否正在等 AI 回复 */
  isChatting: boolean;
  chatError: string | null;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onSendChat: (id: string, content: string) => void;
  onClearChat: (id: string) => void;
  onClose: () => void;
  onRerun: (id: string) => void;
}

/** system 只在拼请求时用，不展示 */
function toVisibleMessages(
  history: readonly ReasoningChatMessage[],
): ReasoningChatMessage[] {
  return history.filter(
    (message) => message.role !== "system" && message.content.trim().length > 0,
  );
}

function formatClock(timestamp?: number): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChatBubble({ message }: { message: ReasoningChatMessage }) {
  const isUser = message.role === "user";
  const clock = formatClock(message.createdAt);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2.5 text-sm leading-6 text-white"
            : "max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5"
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownBlock content={message.content} />
        )}
        {clock ? (
          <p
            className={`mt-1 text-[11px] ${
              isUser ? "text-blue-100" : "text-slate-400"
            }`}
          >
            {clock}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 注意：这个组件在 App 里带了 key（跟随当前查看的录音 id），
 * 换一条录音时会重新挂载，所以 copied / 输入框之类的局部状态天然是干净的，
 * 不需要用 effect 去重置。
 */
export function ReasoningResultModal({
  recording,
  isBusy,
  isChatting,
  chatError,
  hasApiKey,
  onOpenSettings,
  onSendChat,
  onClearChat,
  onClose,
  onRerun,
}: ReasoningResultModalProps) {
  const [copied, setCopied] = useState(false);
  const [question, setQuestion] = useState("");
  /** 「清空讨论」点第一下先变成确认态，避免手滑删掉整段对话 */
  const [confirmingClear, setConfirmingClear] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const result = recording?.reasoning ?? null;
  const messages = recording ? toVisibleMessages(recording.chatHistory) : [];
  const chatCount = messages.length;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // 只有「又多了一条消息」时才把视图滚到底，刚打开时保持看报告开头
  useEffect(() => {
    if (chatCount !== lastCountRef.current) {
      lastCountRef.current = chatCount;
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [chatCount]);

  if (!recording || !result) {
    return null;
  }

  const canSend = hasApiKey && question.trim().length > 0 && !isChatting;

  const send = () => {
    if (!canSend) {
      return;
    }
    onSendChat(recording.id, question.trim());
    setQuestion("");
    setConfirmingClear(false);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法下的回车是在确认候选词，不能当成发送
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    send();
  };

  const buildMarkdown = (): string => {
    const parts: string[] = [
      `# ${recording.fileName} · 定向推演`,
      "",
      `> ${result.identityLabel} · ${result.modelLabel} · ${result.llmModel} · ${formatDateTime(
        result.createdAt,
      )}`,
      "",
      result.content,
    ];
    if (messages.length > 0) {
      parts.push("", "## 继续深度讨论", "");
      for (const message of messages) {
        parts.push(
          message.role === "user"
            ? `**我：** ${message.content}`
            : `**AI：**\n\n${message.content}`,
          "",
        );
      }
    }
    return parts.join("\n");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/25 px-4 py-10 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reasoning-title"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200 ring-inset">
                {result.identityLabel}
              </span>
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 ring-inset">
                {result.modelLabel}
              </span>
              {chatCount > 0 ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 ring-inset">
                  {chatCount} 条讨论
                </span>
              ) : null}
            </div>
            <h2
              id="reasoning-title"
              className="mt-2 truncate text-sm font-semibold text-slate-900"
            >
              {recording.fileName}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {result.llmModel} · {formatDateTime(result.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="max-h-[58vh] overflow-y-auto px-6 py-5">
          <MarkdownBlock content={result.content} />

          <div className="mt-6 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                继续深度讨论
              </h3>
              {chatCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmingClear) {
                      setConfirmingClear(true);
                      return;
                    }
                    setConfirmingClear(false);
                    onClearChat(recording.id);
                  }}
                  disabled={isChatting}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    confirmingClear
                      ? "bg-rose-50 text-rose-600"
                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  }`}
                >
                  {confirmingClear ? "再点一次确认清空" : "清空讨论"}
                </button>
              ) : null}
            </div>

            {chatCount === 0 ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">
                报告看完了有疑问？直接往下问。AI 已经知道你的原始想法和这份报告的全文，会接着往下聊。
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {messages.map((message, index) => (
                  <ChatBubble
                    key={`${message.role}-${message.createdAt ?? index}-${index}`}
                    message={message}
                  />
                ))}
              </div>
            )}

            {isChatting ? (
              <div className="mt-3 flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  AI 正在顺着这份报告想…
                </div>
              </div>
            ) : null}

            {chatError ? (
              <p
                className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700"
                role="alert"
              >
                {chatError}
              </p>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-slate-100 px-6 py-3">
          {hasApiKey ? (
            <>
              <div className="flex items-end gap-2">
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  rows={2}
                  disabled={isChatting}
                  aria-label="继续追问"
                  placeholder="就这份报告继续追问，例如：如果只能先做一件事，应该是哪件？"
                  className="min-h-[46px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isChatting ? "思考中…" : "发送"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Enter 发送 · Shift + Enter 换行 · 每次只把最近 10 条对话发给模型 ·
                讨论存在这条录音里，刷新页面还在
              </p>
            </>
          ) : (
            <p className="text-xs leading-5 text-slate-500">
              还没有填 API Key，追问用的就是设置里那把 key。
              <button
                type="button"
                onClick={onOpenSettings}
                className="ml-1 font-medium text-blue-600 transition-colors hover:text-blue-700"
              >
                去设置
              </button>
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button
            type="button"
            onClick={() => onRerun(recording.id)}
            disabled={isBusy}
            className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            用当前设置重新推演
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              {copied ? "已复制" : chatCount > 0 ? "复制报告+讨论" : "复制 Markdown"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              关闭
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
