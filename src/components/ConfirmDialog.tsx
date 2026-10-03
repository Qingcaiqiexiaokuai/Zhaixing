import { useEffect, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
      if (event.key === "Enter") {
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onCancel, onConfirm]);

  if (!open) {
    return null;
  }

  const confirmClass =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500/40"
      : "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500/40";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/25 px-4 py-10 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
      >
        <div className="px-6 pt-5 pb-4">
          <h2
            id="confirm-title"
            className="text-base font-semibold text-slate-900"
          >
            {title}
          </h2>
          {description ? (
            <div className="mt-2 text-sm leading-6 text-slate-600">
              {description}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:ring-2 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
