import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { AUDIO_ACCEPT, isAcceptedAudioFile } from "../lib/audio";

interface DropZoneProps {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}

export function DropZone({ disabled, onFiles }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter(isAcceptedAudioFile);
      if (files.length > 0) {
        onFiles(files);
      }
    },
    [onFiles],
  );

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) {
      return;
    }
    handleFiles(event.dataTransfer.files);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      handleFiles(event.target.files);
      event.target.value = "";
    }
  };

  const openPicker = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  return (
    <div className="group relative">
      {/* 拖入时向外扩散的柔光，给一点「可以放这里」的反馈 */}
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-1 rounded-[22px] bg-blue-500/10 blur-md transition-opacity duration-200 ${
          isDragging ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="拖拽音频到这里，或点击选择文件"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={openPicker}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          isDragging
            ? "scale-[1.01] border-blue-500 bg-blue-50/70 shadow-lg shadow-blue-500/10"
            : "border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50/80"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          className="hidden"
          onChange={onChange}
        />

        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full border transition-colors duration-200 ${
            isDragging
              ? "border-blue-300 bg-white text-blue-600"
              : "border-slate-200 bg-slate-50 text-slate-400 group-hover:text-blue-500"
          }`}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </div>

        <p className="mt-4 text-base font-medium text-slate-800">
          {isDragging ? "松手即可导入" : "拖拽音频到这里，或点击选择文件"}
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          支持一次多个文件 · .m4a / .mp3 / .wav / .webm
        </p>
      </div>
    </div>
  );
}
