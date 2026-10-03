import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; text: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let ul: string[] = [];
  let ol: string[] = [];
  let para: string[] = [];

  const flush = () => {
    if (ul.length > 0) {
      blocks.push({ kind: "ul", items: ul });
      ul = [];
    }
    if (ol.length > 0) {
      blocks.push({ kind: "ol", items: ol });
      ol = [];
    }
    if (para.length > 0) {
      blocks.push({ kind: "p", text: para.join(" ") });
      para = [];
    }
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flush();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (ol.length > 0 || para.length > 0) {
        flush();
      }
      ul.push(bullet[1]);
      continue;
    }

    const ordered = /^\d+[.、)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (ul.length > 0 || para.length > 0) {
        flush();
      }
      ol.push(ordered[1]);
      continue;
    }

    if (ul.length > 0 || ol.length > 0) {
      flush();
    }
    para.push(line);
  }

  flush();
  return blocks;
}

/** 只处理 **加粗** 和 `行内代码`，不解析 HTML，避免 XSS */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-base font-semibold text-slate-900",
  2: "text-sm font-semibold text-slate-900",
  3: "text-sm font-medium text-slate-800",
  4: "text-xs font-semibold tracking-wide text-slate-600 uppercase",
};

export function MarkdownBlock({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseBlocks(content);

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {blocks.map((block, blockIndex) => {
        const blockKey = `b-${blockIndex}`;

        if (block.kind === "heading") {
          const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
          return (
            <Tag
              key={blockKey}
              className={HEADING_CLASS[block.level] ?? HEADING_CLASS[3]}
            >
              {renderInline(block.text, `h-${blockKey}`)}
            </Tag>
          );
        }

        if (block.kind === "ul") {
          return (
            <ul key={blockKey} className="space-y-1.5">
              {block.items.map((item, index) => (
                <li
                  key={`${blockKey}-${index}`}
                  className="flex gap-2.5 text-sm leading-6 text-slate-700"
                >
                  <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  <span>{renderInline(item, `li-${blockKey}-${index}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.kind === "ol") {
          return (
            <ol key={blockKey} className="space-y-1.5">
              {block.items.map((item, index) => (
                <li
                  key={`${blockKey}-${index}`}
                  className="flex gap-2.5 text-sm leading-6 text-slate-700"
                >
                  <span className="shrink-0 font-mono text-xs text-slate-400 tabular-nums">
                    {index + 1}.
                  </span>
                  <span>{renderInline(item, `oli-${blockKey}-${index}`)}</span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={blockKey} className="text-sm leading-6 text-slate-700">
            {renderInline(block.text, `p-${blockKey}`)}
          </p>
        );
      })}
    </div>
  );
}
