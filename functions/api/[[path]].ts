/**
 * Cloudflare Pages Function：把 /api/<provider>/* 反代到对应的大模型服务。
 *
 * 前端 llm.ts 请求的是同源前缀（vite.config.ts 里配的那几个代理）：
 *   /api/deepseek/v1/chat/completions -> https://api.deepseek.com/v1/chat/completions
 *   /api/openai/v1/chat/completions   -> https://api.openai.com/v1/chat/completions
 *   /api/custom/v1/chat/completions   -> CUSTOM_API_BASE（Pages 环境变量里配）
 *
 * BYOK 没有被破坏：key 仍然只存在浏览器 localStorage 里，由前端放在
 * Authorization 头里带过来，本 Function 原样透传给上游，既不落盘也不记录。
 */

interface Env {
  /**
   * 「自定义」服务商的真实地址，在 Pages → Settings → Variables and Secrets 里配。
   * 默认值对齐 vite.config.ts 里 /api/custom 的 target。
   */
  CUSTOM_API_BASE?: string;
}

/** Pages Functions 的上下文，只声明这里用得到的部分 */
interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
}

const UPSTREAM_BY_PROVIDER: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com",
};

const DEFAULT_CUSTOM_ORIGIN = "https://api.deepseek.com";

/**
 * 只把这三个头转给上游：其它头（cookie、referer、cf-*、sec-fetch-* 等）
 * 对上游没用，还可能泄露部署环境的细节。
 */
const FORWARDED_REQUEST_HEADERS: readonly string[] = [
  "content-type",
  "authorization",
  "accept",
];

/** Workers 已经解压并重算过 body，这两个头不能让浏览器再信一次 */
const STRIPPED_RESPONSE_HEADERS: readonly string[] = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
];

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const url = new URL(context.request.url);
  const match = /^\/api\/([^/]+)(\/.*)?$/.exec(url.pathname);

  if (!match) {
    return jsonError("路径不合法，期望 /api/<provider>/v1/chat/completions", 404);
  }

  const provider = match[1];
  const rest = match[2] && match[2].length > 0 ? match[2] : "/";
  const origin =
    provider === "custom"
      ? (context.env.CUSTOM_API_BASE ?? DEFAULT_CUSTOM_ORIGIN)
      : UPSTREAM_BY_PROVIDER[provider];

  if (!origin) {
    return jsonError(
      `未知的服务商 "${provider}"，只支持 deepseek / openai / custom`,
      404,
    );
  }
  if (context.request.method !== "POST" && context.request.method !== "GET") {
    return jsonError("只支持 GET / POST", 405);
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = context.request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  const target = new URL(`${rest}${url.search}`, origin);

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: context.request.method,
      headers,
      body: context.request.method === "POST" ? context.request.body : undefined,
    });
  } catch (error) {
    return jsonError(
      `连接 ${origin} 失败：${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(name);
  }

  // 直接流式回传：以后前端要加 SSE 流式输出也不用改这里
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
