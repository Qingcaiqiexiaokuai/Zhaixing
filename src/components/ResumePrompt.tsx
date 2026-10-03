import type { Recording } from "../types";

interface ResumePromptProps {
  interrupted: Recording[];
  onResume: () => void;
  onDiscard: () => void;
}

/**
 * 断点续传：上次关网页时停在 queued / thinking 的推演任务，重新打开时问一下要不要接着跑。
 */
export function ResumePrompt({
  interrupted,
  onResume,
  onDiscard,
}: ResumePromptProps) {
  if (interrupted.length === 0) {
    return null;
  }

  const thinkingCount = interrupted.filter(
    (item) => item.reasoningStatus === "thinking",
  ).length;
  const queuedCount = interrupted.length - thinkingCount;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/25 px-4 py-10 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
      >
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 ring-inset">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 8v4l3 2" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <h2
              id="resume-title"
              className="text-base font-semibold text-slate-900"
            >
              有未完成的推演
            </h2>
          </div>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            上次关闭页面时有 <strong className="font-semibold">{interrupted.length}</strong>{" "}
            条推演没跑完
            {thinkingCount > 0 ? `（其中 ${thinkingCount} 条正在推演中` : "（"}
            {queuedCount > 0 ? `，${queuedCount} 条还在排队）` : "）"}。要接着跑吗？
          </p>

          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            {interrupted.map((item) => (
              <li key={item.id} className="truncate text-xs text-slate-600">
                · {item.fileName}
              </li>
            ))}
          </ul>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            先不跑
          </button>
          <button
            type="button"
            onClick={onResume}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            继续推演
          </button>
        </footer>
      </div>
    </div>
  );
}
