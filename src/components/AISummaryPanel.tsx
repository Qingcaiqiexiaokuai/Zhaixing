import type { AISummary } from "../types";
import { formatDateTime } from "../lib/markdown";

interface AISummaryPanelProps {
  summary: AISummary | null;
  isLoading: boolean;
  error: string | null;
  transcribedCount: number;
  hasApiKey: boolean;
  onGenerate: () => void;
  onExport: () => void;
  onClear: () => void;
  onOpenSettings: () => void;
}

function SparkIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function Section({
  title,
  accent,
  items,
}: {
  title: string;
  accent: string;
  items: string[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />
        {title}
      </h4>
      <ul className="mt-2.5 space-y-2">
        {items.map((item, index) => (
          <li
            key={`${title}-${index}`}
            className="flex gap-2.5 text-sm leading-6 text-slate-700"
          >
            <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AISummaryPanel({
  summary,
  isLoading,
  error,
  transcribedCount,
  hasApiKey,
  onGenerate,
  onExport,
  onClear,
  onOpenSettings,
}: AISummaryPanelProps) {
  const hasStructured =
    summary !== null &&
    (summary.coreIdeas.length > 0 ||
      summary.todos.length > 0 ||
      summary.suggestions.length > 0);

  const canGenerate = transcribedCount > 0 && !isLoading;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="text-blue-600">
              <SparkIcon />
            </span>
            AI 提炼
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {summary
              ? `基于 ${summary.sourceCount} 条转写 · ${summary.model} · ${formatDateTime(summary.createdAt)}`
              : "把所有已转写的文字合并，提炼成结构化笔记"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {summary ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              清除
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExport}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            导出 Markdown
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isLoading ? "提炼中…" : "一键 AI 提炼"}
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        {!hasApiKey ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <p className="text-xs text-amber-800">
              还没有配置大模型 API Key，先填一个才能用 AI 提炼。
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
            >
              去设置
            </button>
          </div>
        ) : null}

        {transcribedCount === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            还没有已转写的记录，先转写几段再来提炼。
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {summary && hasStructured ? (
          <div className="space-y-5">
            <Section
              title="核心想法"
              accent="bg-blue-500"
              items={summary.coreIdeas}
            />
            <Section
              title="待办"
              accent="bg-emerald-500"
              items={summary.todos}
            />
            <Section
              title="建议"
              accent="bg-violet-500"
              items={summary.suggestions}
            />
          </div>
        ) : null}

        {summary && !hasStructured ? (
          <div className="mt-1">
            <p className="text-xs text-slate-500">
              模型没有返回结构化 JSON，下面是原始输出：
            </p>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs leading-5 whitespace-pre-wrap text-slate-700">
              {summary.raw}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
