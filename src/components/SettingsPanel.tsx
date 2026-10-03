import { useEffect, useRef, useState } from "react";
import type { AISettings, AIProviderId } from "../types";
import {
  AI_PROVIDERS,
  IDENTITY_PRESETS,
  REASONING_MODEL_PRESETS,
  formatCorrections,
  getProviderPreset,
  parseCorrections,
} from "../lib/settings";
import {
  DEFAULT_TRANSCRIBE_PROMPT,
  TRANSCRIBE_LANGUAGES,
  TRANSCRIPTION_MODELS,
  formatModelSize,
  getTranscriptionModelPreset,
} from "../lib/transcription";

interface SettingsPanelProps {
  settings: AISettings;
  onClose: () => void;
  onSave: (settings: AISettings) => void;
}

function GroupTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {title}
      </h3>
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </div>
  );
}

export function SettingsPanel({
  settings,
  onClose,
  onSave,
}: SettingsPanelProps) {
  // 这个组件只在打开时被挂载（见 App 里的条件渲染），所以直接拿 props 当初始草稿，
  // 每次打开都是全新的。不要用 effect 去 setState 同步 props，那样会多一轮渲染，
  // 也是 react-hooks 明确不建议的写法。
  const [draft, setDraft] = useState<AISettings>(settings);
  const [showKey, setShowKey] = useState(false);
  /** 纠错规则在面板里是原始文本，保存时再 parse：否则边打字边解析会把没写完的行吃掉 */
  const [correctionText, setCorrectionText] = useState(() =>
    formatCorrections(settings.corrections),
  );
  const keyInputRef = useRef<HTMLInputElement>(null);

  // 只在挂载时注册一次：ESC 关闭 + 自动聚焦到 Key 输入框。
  // onClose 由 App 用 useCallback 固定住，所以这个 effect 不会反复重跑抢焦点。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => keyInputRef.current?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [onClose]);

  const preset = getProviderPreset(draft.provider);
  const modelChanged = draft.transcriptionModel !== settings.transcriptionModel;
  const selectedModel = getTranscriptionModelPreset(draft.transcriptionModel);
  const parsedRules = parseCorrections(correctionText);

  const selectProvider = (provider: AIProviderId) => {
    setDraft((current) => ({
      ...current,
      provider,
      model: getProviderPreset(provider).defaultModel,
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/20 px-4 py-10 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2
              id="settings-title"
              className="text-base font-semibold text-slate-900"
            >
              设置
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              密钥只保存在这台浏览器里，不会上传到任何服务器
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="-mr-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="max-h-[62vh] space-y-7 overflow-y-auto px-6 py-5">
          {/* ---------------- 转写 ---------------- */}
          <section className="space-y-5">
            <GroupTitle title="转写" hint="本地 Whisper，音频不出设备" />

            <div>
              <label className="text-sm font-medium text-slate-800">
                识别模型
              </label>
              <div className="mt-2 space-y-2">
                {TRANSCRIPTION_MODELS.map((model) => {
                  const active = draft.transcriptionModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          transcriptionModel: model.id,
                        }))
                      }
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          active
                            ? "border-blue-600 bg-blue-600"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {active ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-sm font-medium ${
                            active ? "text-blue-700" : "text-slate-700"
                          }`}
                        >
                          {model.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {model.description} · {formatModelSize(model)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 shrink-0 text-amber-600"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16.5v.01" />
                </svg>
                <p className="text-xs leading-5 text-amber-800">
                  {modelChanged ? (
                    <>
                      你切换了模型。<strong className="font-semibold">第一次用新模型转写需要重新下载</strong>
                      （{selectedModel.label} {formatModelSize(selectedModel)}），
                      期间进度条会一直停着，属正常现象，请耐心等待。下载会缓存到浏览器里，之后不再重复下载。
                    </>
                  ) : (
                    <>
                      第一次使用当前模型需要下载 {formatModelSize(selectedModel)}，
                      期间进度条会一直停着，请耐心等待。下载会缓存到浏览器里，之后不再重复下载。
                    </>
                  )}
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-800">
                转写语言
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {TRANSCRIBE_LANGUAGES.map((language) => {
                  const active = draft.transcribeLanguage === language.id;
                  return (
                    <button
                      key={language.id}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          transcribeLanguage: language.id,
                        }))
                      }
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`block text-sm font-medium ${
                          active ? "text-blue-700" : "text-slate-700"
                        }`}
                      >
                        {language.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {language.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="transcribe-prompt"
                  className="text-sm font-medium text-slate-800"
                >
                  初始提示词
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      transcribePrompt: DEFAULT_TRANSCRIBE_PROMPT,
                    }))
                  }
                  className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
                >
                  恢复默认
                </button>
              </div>
              <textarea
                id="transcribe-prompt"
                value={draft.transcribePrompt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    transcribePrompt: event.target.value,
                  }))
                }
                rows={3}
                spellCheck={false}
                placeholder={DEFAULT_TRANSCRIBE_PROMPT}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                对应 Whisper 的{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                  initial_prompt
                </code>
                ：转写前先声明录音里可能出现哪些词（网址、App、代码……），模型会据此偏向同音词。留空表示不传。
              </p>
            </div>

            <div>
              <label
                htmlFor="corrections"
                className="text-sm font-medium text-slate-800"
              >
                自定义纠错
              </label>
              <textarea
                id="corrections"
                value={correctionText}
                onChange={(event) => setCorrectionText(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={"王子 -> 网址\n网子 -> 网址\n嗯 -> "}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm leading-6 text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                每行一条，写「错误词 -&gt; 正确词」（也支持 =&gt; 和 →）。转写完成后自动替换再存入
                IndexedDB；右边留空表示直接删掉这个词，# 开头的行是注释。当前已识别{" "}
                <strong className="font-semibold text-slate-700">
                  {parsedRules.length}
                </strong>{" "}
                条规则，保存在 localStorage。
              </p>
            </div>
          </section>

          {/* ---------------- 大模型 ---------------- */}
          <section className="space-y-5 border-t border-slate-100 pt-6">
            <GroupTitle title="大模型" hint="BYOK" />

            <div>
              <label className="text-sm font-medium text-slate-800">
                服务商
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {AI_PROVIDERS.map((provider) => {
                  const active = draft.provider === provider.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => selectProvider(provider.id)}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {provider.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">{preset.hint}</p>
            </div>

            <div>
              <label
                htmlFor="api-key"
                className="text-sm font-medium text-slate-800"
              >
                API Key
              </label>
              <div className="relative mt-2">
                <input
                  id="api-key"
                  ref={keyInputRef}
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-16 pl-3 font-mono text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  {showKey ? "隐藏" : "显示"}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="model-name"
                className="text-sm font-medium text-slate-800"
              >
                模型
              </label>
              <input
                id="model-name"
                type="text"
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
                placeholder={preset.defaultModel}
                spellCheck={false}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-2 text-xs text-slate-500">
                请求经同源代理{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                  {preset.proxyPath}
                </code>{" "}
                转发，因此没有跨域问题。
              </p>
            </div>
          </section>

          {/* ---------------- 定向推演 ---------------- */}
          <section className="space-y-5 border-t border-slate-100 pt-6">
            <GroupTitle
              title="定向推演"
              hint="决定 AI 用什么身份和框架来推演你的想法"
            />

            <div>
              <label className="text-sm font-medium text-slate-800">
                我的身份
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {IDENTITY_PRESETS.map((identity) => {
                  const active = draft.identity === identity.id;
                  return (
                    <button
                      key={identity.id}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          identity: identity.id,
                        }))
                      }
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`block text-sm font-medium ${
                          active ? "text-blue-700" : "text-slate-700"
                        }`}
                      >
                        {identity.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {identity.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-800">
                推演思维模型
              </label>
              <div className="mt-2 space-y-2">
                {REASONING_MODEL_PRESETS.map((model) => {
                  const active = draft.reasoningModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          reasoningModel: model.id,
                        }))
                      }
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          active
                            ? "border-blue-600 bg-blue-600"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {active ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-sm font-medium ${
                            active ? "text-blue-700" : "text-slate-700"
                          }`}
                        >
                          {model.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {model.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onSave({
                provider: draft.provider,
                apiKey: draft.apiKey.trim(),
                model: draft.model.trim() || preset.defaultModel,
                identity: draft.identity,
                reasoningModel: draft.reasoningModel,
                transcriptionModel: draft.transcriptionModel,
                transcribeLanguage: draft.transcribeLanguage,
                transcribePrompt: draft.transcribePrompt.trim(),
                // 以 textarea 里的原始文本为准：用户可能刚敲完还没触发任何解析
                corrections: parsedRules,
              });
              onClose();
            }}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
