import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AISummaryPanel } from "./components/AISummaryPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DropZone } from "./components/DropZone";
import { ReasoningResultModal } from "./components/ReasoningResultModal";
import { RecordButton } from "./components/RecordButton";
import { RecordingList } from "./components/RecordingList";
import { ResumePrompt } from "./components/ResumePrompt";
import { SettingsPanel } from "./components/SettingsPanel";
import { collectTranscribed, generateSummary } from "./lib/ai";
import { getAudioDuration } from "./lib/audio";
import {
  appendRecordingChat,
  clearRecordingChat,
  clearSummary,
  deleteRecording,
  findInterrupted,
  getAllRecordings,
  getLatestSummary,
  getRecording,
  resetTranscriptForRetranscribe,
  saveRecording,
  saveSummary,
  updateRecordingReasoning,
  updateRecordingTranscript,
  updateTranscriptText,
} from "./lib/db";
import { isAbortError } from "./lib/llm";
import {
  buildMarkdown,
  buildMarkdownFileName,
  downloadMarkdown,
} from "./lib/markdown";
import { runReasoning, runReasoningChat } from "./lib/reasoning";
import {
  applyCorrections,
  getIdentityPreset,
  getReasoningModelPreset,
  hasUsableApiKey,
  loadAISettings,
  saveAISettings,
} from "./lib/settings";
import {
  formatModelSize,
  getTranscribeLanguagePreset,
  getTranscriptionModelPreset,
} from "./lib/transcription";
import { getActiveDevice, getTranscriber, transcribeBlob } from "./lib/whisper";
import type {
  AISettings,
  AISummary,
  ModelLoadProgress,
  ReasoningChatMessage,
  Recording,
  RecordingSource,
  TranscribeProgress,
} from "./types";

type ReasoningPatch = Pick<
  Recording,
  "reasoningStatus" | "reasoning" | "reasoningError"
>;

/** 删除时的淡出时长，要和 RecordingList 里的 duration-300 对得上 */
const REMOVE_ANIMATION_MS = 260;

function createRecordingId(): string {
  return crypto.randomUUID();
}

function applyReasoningPatch(
  recordings: Recording[],
  ids: readonly string[],
  patch: ReasoningPatch,
): Recording[] {
  return recordings.map((item) =>
    ids.includes(item.id) ? { ...item, ...patch } : item,
  );
}

function VaultLogo() {
  return (
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
      <path d="M12 3v18" />
      <path d="M5.5 7.5 12 3l6.5 4.5" />
      <path d="M5.5 7.5v9L12 21l6.5-4.5v-9" />
    </svg>
  );
}

function GearIcon() {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function App() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<ModelLoadProgress | null>(
    null,
  );
  const [transcribeProgress, setTranscribeProgress] =
    useState<TranscribeProgress | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);

  const [settings, setSettings] = useState<AISettings>(() => loadAISettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [summary, setSummary] = useState<AISummary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // ---- 定向推演 ----
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [activeReasoningId, setActiveReasoningId] = useState<string | null>(null);
  const [isReasoning, setIsReasoning] = useState(false);
  const [resultModalId, setResultModalId] = useState<string | null>(null);
  /** 正在等 AI 回复的录音 id（可能不止一条：关掉弹窗后请求还在跑） */
  const [chattingIds, setChattingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [chatError, setChatError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<Recording[] | null>(null);

  // ---- 删除 ----
  const [pendingDelete, setPendingDelete] = useState<Recording | null>(null);
  /** 待二次确认的「重新转写」记录 */
  const [pendingRetranscribe, setPendingRetranscribe] = useState<Recording | null>(
    null,
  );
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // 队列跑批期间用的最新设置（避免闭包拿到旧值）
  const settingsRef = useRef(settings);
  const processingRef = useRef(false);
  /** 转写批次的同步闸门：连点两次也只跑一个批次 */
  const transcribingRef = useRef(false);
  /** 当前正在跑的请求，删除对应录音时用它中断 */
  const abortRef = useRef<AbortController | null>(null);
  /** abortRef 对应的录音 id */
  const abortTargetRef = useRef<string | null>(null);
  /** 队列运行期间被删掉的 id，循环里跳过 */
  const cancelledRef = useRef<Set<string>>(new Set());
  /** 每条录音各自的追问请求，删除该录音时按 id 中断 */
  const chatAbortRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [storedRecordings, storedSummary] = await Promise.all([
          getAllRecordings(),
          getLatestSummary(),
        ]);
        if (cancelled) {
          return;
        }
        setRecordings(storedRecordings);
        setSummary(storedSummary);
        const pending = findInterrupted(storedRecordings);
        if (pending.length > 0) {
          setInterrupted(pending);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "读取本地记录失败",
          );
        }
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingCount = useMemo(
    () => recordings.filter((item) => item.status === "pending").length,
    [recordings],
  );

  const transcribedRecordings = useMemo(
    () => collectTranscribed(recordings),
    [recordings],
  );

  // 从选中集合里筛掉已经被删掉/失效的 id，避免计数不准
  const selectedRecordings = useMemo(
    () => recordings.filter((item) => selectedIds.has(item.id)),
    [recordings, selectedIds],
  );

  const resultRecording = useMemo(
    () => recordings.find((item) => item.id === resultModalId) ?? null,
    [recordings, resultModalId],
  );

  const identityLabel = getIdentityPreset(settings.identity).label;
  const modelLabel = getReasoningModelPreset(settings.reasoningModel).label;
  const transcriptionPreset = getTranscriptionModelPreset(
    settings.transcriptionModel,
  );
  const languagePreset = getTranscribeLanguagePreset(
    settings.transcribeLanguage,
  );

  /** 写库 + 同步内存状态 */
  const setReasoning = useCallback(
    async (id: string, patch: ReasoningPatch) => {
      await updateRecordingReasoning(id, patch);
      setRecordings((prev) => applyReasoningPatch(prev, [id], patch));
    },
    [],
  );

  /**
   * 队列状态机：逐个处理，期间卡片状态会依次变成 queued -> thinking -> completed/failed。
   * 状态是落在 IndexedDB 里的，所以中途关掉网页也能在下次打开时续跑。
   * 删除录音时会把 id 放进 cancelledRef，并 abort 掉正在跑的那一条。
   */
  const processQueue = useCallback(
    async (ids: readonly string[]) => {
      if (processingRef.current || ids.length === 0) {
        return;
      }
      processingRef.current = true;
      setIsReasoning(true);
      try {
        for (const id of ids) {
          if (cancelledRef.current.has(id)) {
            continue;
          }

          const current = await getRecording(id);
          if (!current) {
            continue;
          }
          if (current.transcript.trim().length === 0) {
            await setReasoning(id, {
              reasoningStatus: "failed",
              reasoning: null,
              reasoningError: "这条录音还没有转写文字，无法推演。",
            });
            continue;
          }

          setActiveReasoningId(id);
          await setReasoning(id, {
            reasoningStatus: "thinking",
            reasoning: null,
            reasoningError: null,
          });

          const controller = new AbortController();
          abortRef.current = controller;
          abortTargetRef.current = id;

          try {
            const result = await runReasoning(
              settingsRef.current,
              current,
              controller.signal,
            );
            if (cancelledRef.current.has(id)) {
              continue;
            }
            await setReasoning(id, {
              reasoningStatus: "completed",
              reasoning: result,
              reasoningError: null,
            });
          } catch (error) {
            // 被删除/中断的不写失败状态
            if (cancelledRef.current.has(id) || isAbortError(error)) {
              continue;
            }
            await setReasoning(id, {
              reasoningStatus: "failed",
              reasoning: null,
              reasoningError:
                error instanceof Error ? error.message : "推演失败",
            });
          } finally {
            abortRef.current = null;
            abortTargetRef.current = null;
          }
        }
      } finally {
        cancelledRef.current.clear();
        processingRef.current = false;
        setActiveReasoningId(null);
        setIsReasoning(false);
      }
    },
    [setReasoning],
  );

  const enqueue = useCallback(
    async (ids: readonly string[]) => {
      const unique = [...new Set(ids)];
      if (unique.length === 0) {
        return;
      }
      const patch: ReasoningPatch = {
        reasoningStatus: "queued",
        reasoning: null,
        reasoningError: null,
      };
      for (const id of unique) {
        await setReasoning(id, patch);
      }
      setSelectedIds(new Set<string>());
      await processQueue(unique);
    },
    [processQueue, setReasoning],
  );

  /**
   * 导入音频：拖拽/选择文件和网页录音走的是同一条路。
   * source 只影响溯源字段；返回值是刚落库的那几条，调用方可以接着做别的（比如录音后自动转写）。
   */
  const handleFiles = useCallback(
    async (
      files: File[],
      source: RecordingSource = "upload",
    ): Promise<Recording[]> => {
      setErrorMessage(null);
      const next: Recording[] = [];
      for (const file of files) {
        try {
          const duration = await getAudioDuration(file);
          const recording: Recording = {
            id: createRecordingId(),
            fileName: file.name,
            source,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            duration,
            audioBlob: file,
            transcript: "",
            status: "pending",
            createdAt: Date.now(),
            reasoningStatus: "idle",
            reasoning: null,
            reasoningError: null,
            transcribedWith: null,
            chatHistory: [],
          };
          await saveRecording(recording);
          next.push(recording);
        } catch (error) {
          setErrorMessage(
            error instanceof Error ? error.message : `无法导入 ${file.name}`,
          );
        }
      }
      if (next.length > 0) {
        setRecordings((prev) => [...next, ...prev]);
      }
      return next;
    },
    [],
  );

  /**
   * 转写核心：批量和「重新转写单条」都走这里。
   * 跑批期间用户可能改设置，所以进来先固定一份快照。
   * transcribingRef 是同步闸门，防止连点两次起两个批次。
   */
  const runTranscription = useCallback(async (targets: readonly Recording[]) => {
    if (targets.length === 0 || transcribingRef.current) {
      return;
    }
    transcribingRef.current = true;
    const current = settingsRef.current;
    const model = getTranscriptionModelPreset(current.transcriptionModel);
    const language = getTranscribeLanguagePreset(current.transcribeLanguage);
    const transcribedWith = `${model.label} · ${language.label}`;
    // 同音词优化的两份设置：提示词在解码前用，替换规则在入库前用
    const prompt = current.transcribePrompt;
    const corrections = current.corrections;

    setIsBusy(true);
    setErrorMessage(null);
    try {
      await getTranscriber(current.transcriptionModel, (progress) => {
        setModelProgress(progress);
      });
      setDeviceLabel(getActiveDevice());
      setModelProgress({ status: "ready", file: "", progress: 100 });

      for (let index = 0; index < targets.length; index += 1) {
        const recording = targets[index];
        if (!recording) {
          continue;
        }
        setTranscribeProgress({
          current: index + 1,
          total: targets.length,
          recordingId: recording.id,
          fileName: recording.fileName,
        });
        const rawText = await transcribeBlob(recording.audioBlob, {
          modelId: current.transcriptionModel,
          language: current.transcribeLanguage,
          prompt,
        });
        // 先套用「自定义纠错」的替换规则，再写进 IndexedDB
        const text = applyCorrections(rawText, corrections);
        await updateRecordingTranscript(recording.id, text, transcribedWith);
        setRecordings((prev) =>
          prev.map((item) =>
            item.id === recording.id
              ? {
                  ...item,
                  transcript: text,
                  status: "transcribed",
                  transcribedWith,
                }
              : item,
          ),
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "转写失败");
    } finally {
      transcribingRef.current = false;
      setIsBusy(false);
      setTranscribeProgress(null);
    }
  }, []);

  const handleTranscribe = useCallback(() => {
    const pending = recordings.filter((item) => item.status === "pending");
    void runTranscription(pending);
  }, [recordings, runTranscription]);

  /** 重新转写单条：先退回 pending（清空旧文字），再用当前设置只跑这一条 */
  const handleConfirmRetranscribe = useCallback(async () => {
    const target = pendingRetranscribe;
    setPendingRetranscribe(null);
    if (!target || transcribingRef.current) {
      return;
    }
    const reset = await resetTranscriptForRetranscribe(target.id);
    if (!reset) {
      setErrorMessage("这条录音已经不存在了，可能刚刚被删除。");
      return;
    }
    setRecordings((prev) =>
      prev.map((item) => (item.id === reset.id ? reset : item)),
    );
    // 文字被清空后不再可推演，顺手从选中集合里摘掉，避免排到空任务
    setSelectedIds((prev) => {
      if (!prev.has(reset.id)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(reset.id);
      return next;
    });
    await runTranscription([reset]);
  }, [pendingRetranscribe, runTranscription]);

  /**
   * 网页录音用：先按和拖拽上传一样的方式入库，再顺手把这唯一一条排进转写队列，
   * 手机上就是「点一下开始 → 点一下停止 → 自动出文字」。
   * 如果此刻已经有转写批次在跑，runTranscription 会直接返回，这条就留在「未处理」，
   * 点上面的「开始转写」即可。
   */
  const handleRecorded = useCallback(
    async (file: File): Promise<void> => {
      const created = await handleFiles([file], "record");
      const first = created[0];
      if (first) {
        await runTranscription([first]);
      }
    },
    [handleFiles, runTranscription],
  );

  /**
   * 手动编辑转写文字：写库后直接用返回的记录替换内存里那条，
   * 音频 Blob 和推演结果都不受影响。写库失败会抛出，交给卡片显示错误。
   */
  const handleSaveTranscript = useCallback(
    async (id: string, transcript: string): Promise<void> => {
      const updated = await updateTranscriptText(id, transcript);
      if (!updated) {
        throw new Error("这条录音已经不存在了，可能刚刚被删除。");
      }
      setRecordings((prev) =>
        prev.map((item) => (item.id === id ? updated : item)),
      );
    },
    [],
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(transcribedRecordings.map((item) => item.id)));
  }, [transcribedRecordings]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set<string>());
  }, []);

  const handleSaveSettings = useCallback((next: AISettings) => {
    setSettings(next);
    saveAISettings(next);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleCloseResult = useCallback(() => {
    setResultModalId(null);
  }, []);

  const handleResume = useCallback(() => {
    const ids = (interrupted ?? []).map((item) => item.id);
    setInterrupted(null);
    void enqueue(ids);
  }, [interrupted, enqueue]);

  const handleDiscardInterrupted = useCallback(async () => {
    const ids = (interrupted ?? []).map((item) => item.id);
    setInterrupted(null);
    const patch: ReasoningPatch = {
      reasoningStatus: "idle",
      reasoning: null,
      reasoningError: null,
    };
    for (const id of ids) {
      await setReasoning(id, patch);
    }
  }, [interrupted, setReasoning]);

  // ---- 继续深度讨论 ----

  const handleViewResult = useCallback((id: string) => {
    setChatError(null);
    setResultModalId(id);
  }, []);

  const handleSendChat = useCallback(
    async (id: string, question: string): Promise<void> => {
      const trimmed = question.trim();
      if (trimmed.length === 0 || chattingIds.has(id)) {
        return;
      }
      const target = recordings.find((item) => item.id === id);
      if (!target) {
        setChatError("这条录音已经不存在了，可能刚刚被删除。");
        return;
      }
      setChatError(null);
      setChattingIds((prev) => new Set(prev).add(id));

      // 先把用户这条落库再发请求：接口报错也不会把问题弄丢
      const userMessage: ReasoningChatMessage = {
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      const withQuestion = await appendRecordingChat(id, userMessage);
      if (!withQuestion) {
        setChattingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setChatError("这条录音已经不存在了，可能刚刚被删除。");
        return;
      }
      setRecordings((prev) =>
        prev.map((item) => (item.id === id ? withQuestion : item)),
      );

      const controller = new AbortController();
      chatAbortRef.current.set(id, controller);
      try {
        // BYOK：用的就是设置里那把 key，经同源代理发出，前端不存第二份
        const answer = await runReasoningChat(
          settingsRef.current,
          withQuestion,
          trimmed,
          controller.signal,
        );
        const withAnswer = await appendRecordingChat(id, {
          role: "assistant",
          content: answer,
          createdAt: Date.now(),
        });
        if (withAnswer) {
          setRecordings((prev) =>
            prev.map((item) => (item.id === id ? withAnswer : item)),
          );
        }
      } catch (error) {
        if (!isAbortError(error)) {
          setChatError(
            error instanceof Error ? error.message : "追问失败，稍后再试。",
          );
        }
      } finally {
        chatAbortRef.current.delete(id);
        setChattingIds((prev) => {
          if (!prev.has(id)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [chattingIds, recordings],
  );

  const handleClearChat = useCallback(async (id: string) => {
    const cleared = await clearRecordingChat(id);
    if (!cleared) {
      setChatError("这条录音已经不存在了，可能刚刚被删除。");
      return;
    }
    setChatError(null);
    setRecordings((prev) =>
      prev.map((item) => (item.id === id ? cleared : item)),
    );
  }, []);

  // ---- 删除 ----

  const handleRequestDelete = useCallback(
    (id: string) => {
      setPendingDelete(recordings.find((item) => item.id === id) ?? null);
    },
    [recordings],
  );

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) {
      return;
    }
    const id = target.id;

    // 正在排队或推演中的，先从队列里摘掉
    if (
      target.reasoningStatus === "queued" ||
      target.reasoningStatus === "thinking"
    ) {
      cancelledRef.current.add(id);
      if (abortTargetRef.current === id) {
        abortRef.current?.abort();
      }
    }

    // 这条录音的追问请求也一起中断，别让回答写回一条已经删掉的记录
    chatAbortRef.current.get(id)?.abort();
    chatAbortRef.current.delete(id);

    // 先播放淡出动画，再从数据里真正移除
    setRemovingIds((prev) => new Set(prev).add(id));
    await new Promise((resolve) =>
      window.setTimeout(resolve, REMOVE_ANIMATION_MS),
    );

    try {
      await deleteRecording(id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败");
    }

    setRecordings((prev) => prev.filter((item) => item.id !== id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setResultModalId((prev) => (prev === id ? null : prev));
    setInterrupted((prev) =>
      prev ? prev.filter((item) => item.id !== id) : prev,
    );
    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [pendingDelete]);

  // ---- 重新转写 ----

  const handleRequestRetranscribe = useCallback(
    (id: string) => {
      setPendingRetranscribe(recordings.find((item) => item.id === id) ?? null);
    },
    [recordings],
  );

  const handleCancelRetranscribe = useCallback(() => {
    setPendingRetranscribe(null);
  }, []);

  // ---- AI 提炼 / 导出 ----

  const handleGenerateSummary = useCallback(async () => {
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const result = await generateSummary(settings, recordings);
      await saveSummary(result);
      setSummary(result);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "AI 提炼失败");
    } finally {
      setIsSummarizing(false);
    }
  }, [settings, recordings]);

  const handleExport = useCallback(() => {
    if (recordings.length === 0) {
      setErrorMessage("还没有任何记录可以导出。");
      return;
    }
    downloadMarkdown(
      buildMarkdownFileName(),
      buildMarkdown(recordings, summary),
    );
  }, [recordings, summary]);

  const handleClearSummary = useCallback(async () => {
    await clearSummary();
    setSummary(null);
    setSummaryError(null);
  }, []);

  const progressValue = modelProgress
    ? Math.min(100, Math.max(0, modelProgress.progress))
    : 0;

  return (
    <div className="min-h-svh bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <VaultLogo />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              灵感库
            </span>
            <span className="hidden text-xs text-slate-400 sm:inline">
              Inspiration Vault
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isReasoning ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset sm:inline-flex">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                推演队列运行中
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleOpenSettings}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <GearIcon />
              设置
              {hasUsableApiKey(settings) ? (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : null}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            灵感库
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            本地拖入音频，用 Whisper 在浏览器中转写，再让 AI 按你选的身份和思维模型做定向推演。
          </p>
        </div>

        <DropZone disabled={isBusy} onFiles={(files) => void handleFiles(files)} />

        <RecordButton
          className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
          onRecorded={(file) => void handleRecorded(file)}
        />

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">模型与转写</h2>
              <p className="mt-1 text-xs text-slate-500">
                {transcriptionPreset.label} · {languagePreset.label}
                {deviceLabel
                  ? ` · 当前设备 ${deviceLabel}`
                  : " · 优先 WebGPU，失败降级 wasm"}
              </p>
            </div>
            <button
              type="button"
              disabled={isBusy || pendingCount === 0}
              onClick={() => void handleTranscribe()}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isBusy ? "处理中…" : `开始转写（${pendingCount}）`}
            </button>
          </div>

          {!deviceLabel ? (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              首次使用 {transcriptionPreset.label} 需要下载{" "}
              {formatModelSize(transcriptionPreset)}
              ，期间进度条可能长时间不动，请耐心等待；下载会缓存，之后不再重复下载。
            </p>
          ) : null}

          {modelProgress ? (
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-1.5 flex items-center justify-between gap-4 text-xs text-slate-500">
                <span className="truncate">
                  模型加载 · {modelProgress.status}
                  {modelProgress.file ? ` · ${modelProgress.file}` : ""}
                </span>
                <span className="shrink-0 tabular-nums">
                  {Math.round(progressValue)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progressValue}%` }}
                />
              </div>
            </div>
          ) : null}

          {transcribeProgress ? (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
              转写进度 {transcribeProgress.current}/{transcribeProgress.total}：
              {transcribeProgress.fileName}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="border-t border-rose-100 bg-rose-50/60 px-5 py-3 text-sm text-rose-700">
              {errorMessage}
            </p>
          ) : null}
        </section>

        <div className="mt-5">
          <AISummaryPanel
            summary={summary}
            isLoading={isSummarizing}
            error={summaryError}
            transcribedCount={transcribedRecordings.length}
            hasApiKey={hasUsableApiKey(settings)}
            onGenerate={() => void handleGenerateSummary()}
            onExport={handleExport}
            onClear={() => void handleClearSummary()}
            onOpenSettings={handleOpenSettings}
          />
        </div>

        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">文件列表</h2>
            {recordings.length > 0 ? (
              <span className="text-xs text-slate-400">
                共 {recordings.length} 条 · {transcribedRecordings.length} 条已转写
              </span>
            ) : null}
          </div>

          {transcribedRecordings.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="min-w-0 text-xs text-slate-600">
                已选{" "}
                <strong className="font-semibold text-slate-900">
                  {selectedRecordings.length}
                </strong>{" "}
                条
                <span className="ml-2 text-slate-400">
                  身份 {identityLabel} · 模型 {modelLabel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={
                    selectedRecordings.length > 0
                      ? handleClearSelection
                      : handleSelectAll
                  }
                  className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                  {selectedRecordings.length > 0 ? "清空选择" : "全选已转写"}
                </button>
                <button
                  type="button"
                  disabled={selectedRecordings.length === 0 || isReasoning}
                  onClick={() =>
                    void enqueue(selectedRecordings.map((item) => item.id))
                  }
                  className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isReasoning
                    ? "推演中…"
                    : `开始定向推演（${selectedRecordings.length}）`}
                </button>
              </div>
            </div>
          ) : null}

          {isHydrating ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              正在读取本地记录…
            </p>
          ) : (
            <RecordingList
              recordings={recordings}
              activeId={transcribeProgress?.recordingId ?? null}
              activeReasoningId={activeReasoningId}
              selectedIds={selectedIds}
              removingIds={removingIds}
              reasoningBusy={isReasoning}
              onToggleSelect={handleToggleSelect}
              onReason={(id) => void enqueue([id])}
              onViewResult={handleViewResult}
              onRequestDelete={handleRequestDelete}
              onSaveTranscript={handleSaveTranscript}
              onRetranscribe={handleRequestRetranscribe}
              transcribeBusy={isBusy}
            />
          )}
        </section>

        <footer className="mt-10 pb-6 text-center text-xs text-slate-400">
          所有音频、转写与推演结果都只保存在这台设备的 IndexedDB 里 · API Key 存在
          localStorage
        </footer>
      </main>

      {isSettingsOpen ? (
        <SettingsPanel
          settings={settings}
          onClose={handleCloseSettings}
          onSave={handleSaveSettings}
        />
      ) : null}

      <ReasoningResultModal
        key={resultModalId ?? "none"}
        recording={resultRecording}
        isBusy={isReasoning}
        isChatting={resultModalId !== null && chattingIds.has(resultModalId)}
        chatError={chatError}
        hasApiKey={hasUsableApiKey(settings)}
        onOpenSettings={() => {
          // 设置面板和这个弹窗同为 z-50，先关掉弹窗再开设置，否则会被压在下面
          setResultModalId(null);
          handleOpenSettings();
        }}
        onSendChat={(id, text) => void handleSendChat(id, text)}
        onClearChat={(id) => void handleClearChat(id)}
        onClose={handleCloseResult}
        onRerun={(id) => {
          setResultModalId(null);
          void enqueue([id]);
        }}
      />

      <ResumePrompt
        interrupted={interrupted ?? []}
        onResume={handleResume}
        onDiscard={() => void handleDiscardInterrupted()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条录音？"
        description={
          pendingDelete ? (
            <>
              将永久删除「{pendingDelete.fileName}」的音频、转写文字
              {pendingDelete.reasoning ? "和推演结果" : ""}，
              {pendingDelete.reasoningStatus === "thinking" ||
              pendingDelete.reasoningStatus === "queued"
                ? "并取消它正在排队的推演任务，"
                : ""}
              此操作无法撤销。
            </>
          ) : null
        }
        confirmLabel="删除"
        tone="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={handleCancelDelete}
      />

      <ConfirmDialog
        open={pendingRetranscribe !== null}
        title="重新转写这一条？"
        description={
          pendingRetranscribe ? (
            <>
              会用当前设置（{transcriptionPreset.label} · {languagePreset.label}）
              重跑「{pendingRetranscribe.fileName}」的音频，现有转写文字会被替换；
              音频和推演结果不受影响。
            </>
          ) : null
        }
        confirmLabel="重新转写"
        tone="primary"
        onConfirm={() => void handleConfirmRetranscribe()}
        onCancel={handleCancelRetranscribe}
      />
    </div>
  );
}
