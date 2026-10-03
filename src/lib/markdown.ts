import type { AISummary, ReasoningResult, Recording } from "../types";
import { formatDuration, formatFileSize } from "./audio";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function pushList(lines: string[], items: string[]): void {
  if (items.length === 0) {
    lines.push("_（无）_");
    lines.push("");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

/** 把推演结果整体缩进一级，方便嵌到录音条目下面 */
function indentBlock(text: string, prefix = "> "): string {
  return text
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `${prefix}${line}` : prefix.trimEnd()))
    .join("\n");
}

export function buildMarkdown(
  recordings: Recording[],
  summary: AISummary | null,
): string {
  const transcribedCount = recordings.filter(
    (item) => item.status === "transcribed" && item.transcript.trim().length > 0,
  ).length;
  const reasoned = recordings.filter(
    (item): item is Recording & { reasoning: ReasoningResult } =>
      item.reasoningStatus === "completed" && item.reasoning !== null,
  );

  const lines: string[] = [];
  lines.push("# 灵感库 · 语音笔记");
  lines.push("");
  lines.push(`> 导出时间：${formatDateTime(Date.now())}`);
  lines.push(
    `> 共 ${recordings.length} 条记录，其中 ${transcribedCount} 条已转写，${reasoned.length} 条已定向推演`,
  );
  lines.push("");

  if (summary) {
    lines.push("## AI 提炼");
    lines.push("");
    lines.push(
      `> 模型 \`${summary.model}\` · 基于 ${summary.sourceCount} 条转写 · ${formatDateTime(summary.createdAt)}`,
    );
    lines.push("");
    lines.push("### 核心想法");
    lines.push("");
    pushList(lines, summary.coreIdeas);
    lines.push("### 待办");
    lines.push("");
    pushList(lines, summary.todos);
    lines.push("### 建议");
    lines.push("");
    pushList(lines, summary.suggestions);
  }

  if (reasoned.length > 0) {
    lines.push("## 定向推演");
    lines.push("");
    for (const recording of reasoned) {
      const result = recording.reasoning;
      lines.push(`### ${recording.fileName}`);
      lines.push("");
      lines.push(
        `> 身份 \`${result.identityLabel}\` · 模型 \`${result.modelLabel}\` · LLM \`${result.llmModel}\` · ${formatDateTime(result.createdAt)}`,
      );
      lines.push("");
      lines.push(result.content);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## 原始转写");
  lines.push("");

  if (recordings.length === 0) {
    lines.push("_（暂无记录）_");
    lines.push("");
  }

  recordings.forEach((recording, index) => {
    lines.push(`### ${index + 1}. ${recording.fileName}`);
    lines.push("");
    lines.push(`- 时长：${formatDuration(recording.duration)}`);
    lines.push(`- 大小：${formatFileSize(recording.size)}`);
    lines.push(`- 导入时间：${formatDateTime(recording.createdAt)}`);
    lines.push("");
    const transcript = recording.transcript.trim();
    lines.push(transcript.length > 0 ? transcript : "_（尚未转写）_");
    lines.push("");

    if (recording.reasoningStatus === "completed" && recording.reasoning) {
      lines.push(
        `**定向推演（${recording.reasoning.identityLabel} · ${recording.reasoning.modelLabel}）**`,
      );
      lines.push("");
      lines.push(indentBlock(recording.reasoning.content));
      lines.push("");
    }
  });

  return lines.join("\n");
}

export function buildMarkdownFileName(): string {
  const now = new Date();
  return `灵感库-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
}

export function downloadMarkdown(fileName: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
