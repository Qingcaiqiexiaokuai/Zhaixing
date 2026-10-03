import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AISummary,
  AudioPayload,
  ReasoningChatMessage,
  RecordingSource,
  ReasoningStatus,
  Recording,
} from "../types";
import { DEFAULT_AUDIO_MIME, toAudioBlob } from "./audio";

const DB_NAME = "inspiration-vault";
const RECORDINGS_STORE = "recordings";
const SUMMARIES_STORE = "summaries";
const DB_VERSION = 2;
const LATEST_SUMMARY_KEY = "latest";

export interface SummaryRecord {
  id: string;
  summary: AISummary;
}

interface InspirationVaultDB extends DBSchema {
  recordings: {
    key: string;
    value: Recording;
  };
  summaries: {
    key: string;
    value: SummaryRecord;
  };
}

/**
 * IndexedDB 里真正躺着的形态：音频字段可能是 Blob，也可能是老版本写进去的
 * ArrayBuffer / Uint8Array，甚至整条记录缺字段。读写两侧都过一遍归一化。
 */
type PersistedRecording = Omit<
  Recording,
  "audioBlob" | "chatHistory" | "source"
> & {
  audioBlob?: AudioPayload | null;
  mimeType?: string;
  /** 老记录里还没有这个字段 */
  chatHistory?: unknown;
  /** 老记录里还没有这个字段，读出来按 upload 处理 */
  source?: unknown;
};

function isChatRole(value: unknown): value is ReasoningChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

/** 讨论历史一律归一化：丢掉结构不对的条目，只保留 role + content(+createdAt) */
function normalizeChatHistory(value: unknown): ReasoningChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const messages: ReasoningChatMessage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = typeof record.content === "string" ? record.content : "";
    if (!isChatRole(role) || content.trim().length === 0) {
      continue;
    }
    const createdAt = record.createdAt;
    messages.push(
      typeof createdAt === "number" && Number.isFinite(createdAt)
        ? { role, content, createdAt }
        : { role, content },
    );
  }
  return messages;
}

function normalizeSource(value: unknown): RecordingSource {
  return value === "record" ? "record" : "upload";
}

let dbPromise: Promise<IDBPDatabase<InspirationVaultDB>> | null = null;

function getDb(): Promise<IDBPDatabase<InspirationVaultDB>> {
  if (!dbPromise) {
    dbPromise = openDB<InspirationVaultDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
          database.createObjectStore(RECORDINGS_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(SUMMARIES_STORE)) {
          database.createObjectStore(SUMMARIES_STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 老版本写进 IndexedDB 的记录没有推演 / 转写元信息字段，读出来时统一补齐默认值，
 * 这样不需要再升 DB 版本，也不会让旧数据变成脏数据。
 * 音频也在这里统一成 Blob：ArrayBuffer / Uint8Array 一律包成 Blob，
 * 之后 AudioPlayer 只要拿到 Blob 就能 createObjectURL。
 */
function normalizeRecording(recording: PersistedRecording): Recording {
  const mimeType =
    typeof recording.mimeType === "string" && recording.mimeType.length > 0
      ? recording.mimeType
      : DEFAULT_AUDIO_MIME;
  return {
    ...recording,
    source: normalizeSource(recording.source),
    mimeType,
    audioBlob: recording.audioBlob
      ? toAudioBlob(recording.audioBlob, mimeType)
      : new Blob([], { type: mimeType }),
    reasoningStatus: recording.reasoningStatus ?? "idle",
    reasoning: recording.reasoning ?? null,
    reasoningError: recording.reasoningError ?? null,
    transcribedWith: recording.transcribedWith ?? null,
    chatHistory: normalizeChatHistory(recording.chatHistory),
  };
}

export async function getAllRecordings(): Promise<Recording[]> {
  const db = await getDb();
  const recordings = (await db.getAll(
    RECORDINGS_STORE,
  )) as PersistedRecording[];
  return recordings
    .map(normalizeRecording)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRecording(id: string): Promise<Recording | null> {
  const db = await getDb();
  const record: PersistedRecording | undefined = await db.get(
    RECORDINGS_STORE,
    id,
  );
  return record ? normalizeRecording(record) : null;
}

export async function saveRecording(recording: Recording): Promise<void> {
  const db = await getDb();
  await db.put(RECORDINGS_STORE, normalizeRecording(recording));
}

export async function updateRecordingTranscript(
  id: string,
  transcript: string,
  transcribedWith: string,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get(RECORDINGS_STORE, id);
  if (!existing) {
    return;
  }
  await db.put(RECORDINGS_STORE, {
    ...normalizeRecording(existing),
    transcript,
    status: "transcribed",
    transcribedWith,
  });
}

/**
 * 重新转写前把这条记录退回「未处理」：清空旧文字、status 置回 pending。
 * 音频 Blob、推演结果等字段都不动，转写完成后由 updateRecordingTranscript 写回。
 */
export async function resetTranscriptForRetranscribe(
  id: string,
): Promise<Recording | null> {
  const db = await getDb();
  const existing = await db.get(RECORDINGS_STORE, id);
  if (!existing) {
    return null;
  }
  const next: Recording = {
    ...normalizeRecording(existing),
    transcript: "",
    status: "pending",
  };
  await db.put(RECORDINGS_STORE, next);
  return next;
}

/** 只更新推演相关字段，避免把并发中的其他字段覆盖掉 */
export async function updateRecordingReasoning(
  id: string,
  patch: Pick<Recording, "reasoningStatus" | "reasoning" | "reasoningError">,
): Promise<Recording | null> {
  const db = await getDb();
  const existing = await db.get(RECORDINGS_STORE, id);
  if (!existing) {
    return null;
  }
  const next: Recording = { ...normalizeRecording(existing), ...patch };
  await db.put(RECORDINGS_STORE, next);
  return next;
}

/**
 * 用户手动编辑转写文字。
 * 只动 transcript / status，音频 Blob、推演结果和 transcribedWith 元信息原样保留，
 * 返回写库后的最新记录，方便调用方直接同步 UI。
 */
export async function updateTranscriptText(
  id: string,
  transcript: string,
): Promise<Recording | null> {
  const db = await getDb();
  const existing = await db.get(RECORDINGS_STORE, id);
  if (!existing) {
    return null;
  }
  const normalized = normalizeRecording(existing);
  const next: Recording = {
    ...normalized,
    transcript,
    status: transcript.trim().length > 0 ? "transcribed" : normalized.status,
  };
  await db.put(RECORDINGS_STORE, next);
  return next;
}

/**
 * 往这条录音的讨论历史里追加一条消息（读-改-写），返回写库后的最新记录。
 * 用返回值直接替换内存里那条，UI 就不会和 IndexedDB 脱节。
 */
export async function appendRecordingChat(
  id: string,
  message: ReasoningChatMessage,
): Promise<Recording | null> {
  const db = await getDb();
  const existing = await db.get(RECORDINGS_STORE, id);
  if (!existing) {
    return null;
  }
  const normalized = normalizeRecording(existing);
  const next: Recording = {
    ...normalized,
    chatHistory: [...normalized.chatHistory, message],
  };
  await db.put(RECORDINGS_STORE, next);
  return next;
}

/** 清空这条录音的讨论历史（推演结果本身保留） */
export async function clearRecordingChat(id: string): Promise<Recording | null> {
  const db = await getDb();
  const existing = await db.get(RECORDINGS_STORE, id);
  if (!existing) {
    return null;
  }
  const next: Recording = { ...normalizeRecording(existing), chatHistory: [] };
  await db.put(RECORDINGS_STORE, next);
  return next;
}

/**
 * 彻底删除一条记录。音频 Blob、转写文字、推演结果都在同一条 record 里，
 * 所以一次 delete 就全没了。
 */
export async function deleteRecording(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(RECORDINGS_STORE, id);
}

/** 找出被中断的推演任务（关网页时停在 queued / thinking 的） */
export function findInterrupted(recordings: Recording[]): Recording[] {
  const states: ReasoningStatus[] = ["queued", "thinking"];
  return recordings.filter((item) => states.includes(item.reasoningStatus));
}

export async function getLatestSummary(): Promise<AISummary | null> {
  const db = await getDb();
  const record = await db.get(SUMMARIES_STORE, LATEST_SUMMARY_KEY);
  return record?.summary ?? null;
}

export async function saveSummary(summary: AISummary): Promise<void> {
  const db = await getDb();
  await db.put(SUMMARIES_STORE, { id: LATEST_SUMMARY_KEY, summary });
}

export async function clearSummary(): Promise<void> {
  const db = await getDb();
  await db.delete(SUMMARIES_STORE, LATEST_SUMMARY_KEY);
}
