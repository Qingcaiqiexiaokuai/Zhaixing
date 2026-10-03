import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * hf-mirror.com 有防盗链：请求头里带 Referer 时（网页里的 fetch 会自动带上当前
 * 页面地址，地址栏直接访问则不带），它会返回 200 + 「警告：未授权访问」的 HTML
 * 页面，于是 JSON.parse 报 Unexpected token '<', "<!DOCTYPE "...。
 *
 * 这个中间件在 server.proxy 之前把 Referer / Origin 摘掉。注意不能写在 proxy 的
 * proxyReq 事件里：开了 followRedirects 之后，跟跳转时的 proxyReq 会在请求头
 * 已经发出之后才触发，removeHeader 会抛 ERR_HTTP_HEADERS_SENT 直接把 dev
 * server 打挂。
 */
function stripHotlinkHeaders(): Plugin {
  return {
    name: "strip-hotlink-headers",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith("/hf/")) {
          delete req.headers.referer;
          delete req.headers.origin;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripHotlinkHeaders()],
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    proxy: {
      // ---------- 模型下载 ----------
      // 浏览器只请求同源的 /hf/*，由 Vite(dev server) 转发到 hf-mirror.com，
      // 这样浏览器端不再有跨域请求，彻底绕开 CORS。
      "/hf": {
        target: "https://hf-mirror.com",
        changeOrigin: true,
        // hf-mirror 会把 /xxx/resolve/main/yyy 用 307 跳到
        // /api/resolve-cache/xxx/<sha>/yyy。followRedirects 让代理在
        // 服务端就把这个跳转跟完，浏览器只会看到最终的 200。
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/hf/, ""),
      },

      // ---------- 大模型 API ----------
      // 浏览器直连这些 API 会因为缺少 CORS 响应头被拦，统一走 dev server 转发。
      // 前端请求 /api/deepseek/v1/chat/completions
      //   -> https://api.deepseek.com/v1/chat/completions
      "/api/deepseek": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/deepseek/, ""),
      },
      // 前端请求 /api/openai/v1/chat/completions
      //   -> https://api.openai.com/v1/chat/completions
      "/api/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ""),
      },
      // 自定义 OpenAI 兼容服务（智谱 / Moonshot / 通义 / 本地 Ollama 等）：
      // 把下面的 target 换成你的服务地址即可，前端选「自定义」。
      // 例：Moonshot -> https://api.moonshot.cn
      //     Ollama   -> http://127.0.0.1:11434
      "/api/custom": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/custom/, ""),
      },
    },
  },
});
