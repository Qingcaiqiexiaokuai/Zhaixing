/**
 * Cloudflare Pages Function：把 /hf/* 反代到 hf-mirror.com。
 *
 * 前端 whisper.ts 里写的是 env.remoteHost = location.origin + "/hf"，
 * 开发时这条路由由 vite.config.ts 的 dev server 代理提供；部署到静态托管后
 * 没有 dev server，就由这个 Function 顶上，行为与本地保持一致：
 *   /hf/onnx-community/whisper-base/resolve/main/config.json
 *     -> https://hf-mirror.com/onnx-community/whisper-base/resolve/main/config.json
 *
 * 三个和 vite 那份代理对齐的关键点：
 * 1. 摘掉 Referer / Origin —— hf-mirror 有防盗链，带这两个头会返回 200 + 一个
 *    「未授权访问」的 HTML 页；
 * 2. follow redirect —— hf-mirror 会把 /xxx/resolve/main/yyy 用 307 跳到
 *    /api/resolve-cache/xxx/<sha>/yyy，必须在服务端跟完，浏览器只看到 200；
 * 3. 万一还是拿到了 HTML，直接拦成 502 —— 这种内容一旦被 transformers.js 写进
 *    Cache Storage 就永久脏了（项目里的 purgePoisonedCache 就是为它写的）。
 */

const UPSTREAM_ORIGIN = "https://hf-mirror.com";

/** Pages Functions 的上下文，只声明这里用得到的部分，避免引入额外类型依赖 */
interface PagesContext {
  request: Request;
  env: Record<string, unknown>;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** 不能带给上游的请求头 */
const STRIPPED_REQUEST_HEADERS: readonly string[] = [
  "host",
  "referer",
  "origin",
  "cookie",
];

/**
 * 不能带回浏览器的响应头：
 * Workers 运行时拿到的 body 已经解压过了，再带上 content-encoding / content-length
 * 会让浏览器按错误的长度和编码去解析。
 */
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
  const path = url.pathname.replace(/^\/hf/, "");

  if (path.length === 0 || path === "/") {
    return jsonError("缺少模型路径：期望 /hf/<model>/resolve/<rev>/<file>", 404);
  }

  const target = new URL(`${path}${url.search}`, UPSTREAM_ORIGIN);
  const headers = new Headers(context.request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) {
    headers.delete(name);
  }

  // Range 之类的头照原样转发，方便浏览器/HTTP 缓存做断点续传
  const bodyless =
    context.request.method === "GET" || context.request.method === "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: context.request.method,
      headers,
      body: bodyless ? undefined : context.request.body,
      redirect: "follow",
    });
  } catch (error) {
    return jsonError(
      `连接 hf-mirror 失败：${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (upstream.ok && contentType.includes("text/html")) {
    return jsonError(
      "hf-mirror 返回了 HTML 页面（多半撞上防盗链了），请稍后重试；如果一直这样，把设置里的模型换成更小的那个试试。",
      502,
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(name);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
