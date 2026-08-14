// scripts/lib/offline-ai.mjs
// 离线全量生成共用的模型调用器：复用项目 provider 配置（.env.local），
// 不输出密钥；提供并发池、429/5xx 指数退避、每项有限重试、JSONL 检查点、
// 断点续跑（resume 不重复调用）与失败队列自动重跑。
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const DEFAULT_MODEL = "deepseek-v4-flash";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

/** 解析 .env.local 内容（与 lib/ai-provider.ts 的 getProviderConfig 同语义）。 */
export function parseProviderEnv(content) {
  const map = new Map();
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) map.set(match[1], match[2].trim());
  }
  return {
    apiKey: map.get("DEEPSEEK_API_KEY") ?? map.get("OPENAI_API_KEY"),
    baseUrl: map.get("OPENAI_BASE_URL") ?? DEFAULT_BASE_URL,
    model: map.get("OPENAI_MODEL") ?? DEFAULT_MODEL,
  };
}

export async function readProviderFromEnv(envFile = ".env.local") {
  return parseProviderEnv(await readFile(envFile, "utf8"));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header) {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

/**
 * 单次 chat/completions 调用。429/5xx 指数退避重试（尊重 Retry-After），
 * 其余错误抛出。返回 { content, usage }。
 */
export async function requestChat(provider, options) {
  const {
    messages,
    temperature = 0.2,
    maxTokens = 1200,
    timeoutMs = 90_000,
    thinkingDisabled = true,
    responseFormat = "json_object",
    maxAttempts = 5,
    onRetry,
  } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(
        `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            ...(thinkingDisabled ? { thinking: { type: "disabled" } } : {}),
            ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
            temperature,
            max_tokens: maxTokens,
            messages,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(`模型服务返回 ${response.status}`);
        error.status = response.status;
        error.retryAfterMs = retryAfterMs(response.headers.get("retry-after"));
        error.body = body.slice(0, 200);
        throw error;
      }
      const data = await response.json().catch(() => ({}));
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage ?? {};
      return {
        content: typeof content === "string" ? content : "",
        usage: {
          promptTokens: Number(usage.prompt_tokens) || 0,
          completionTokens: Number(usage.completion_tokens) || 0,
        },
      };
    } catch (error) {
      lastError = error;
      const status = error?.status;
      if (status === 429 || (status >= 500 && status <= 599)) {
        if (attempt >= maxAttempts) break;
        const delay = Math.min(
          60_000,
          Math.max(1_000, error.retryAfterMs ?? 1_000 * 2 ** (attempt - 1))
            + Math.floor(Math.random() * 400),
        );
        onRetry?.({ attempt, status, delay, message: error?.message ?? String(error) });
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 检查点驱动的批量任务执行器。
 * statePath 记录已完成与失败集合；results/<key>.json 存单项结果。
 * --resume 时跳过已完成项，绝不重复调用。
 */
export function createBatchRunner({
  name,
  statePath,
  resultPathFor,
  perItemAttempts = 3,
  maxConcurrent = 10,
  progressEveryItems = 100,
  progressEveryMs = 5 * 60 * 1000,
  onLog = (message) => console.log(`[${name}] ${message}`),
}) {
  let completed = new Set();
  let failed = new Map();
  let stats = {
    name,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finished: false,
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    promptTokens: 0,
    completionTokens: 0,
    calls: 0,
  };
  let lastProgressAt = Date.now();
  let lastProgressCount = 0;

  async function load() {
    try {
      const raw = JSON.parse(await readFile(statePath, "utf8"));
      completed = new Set(raw.completed ?? []);
      failed = new Map(Object.entries(raw.failed ?? {}));
      stats = { ...stats, ...raw.stats };
    } catch {
      // 无检查点：全新开始
    }
  }

  async function save() {
    stats.failedItems = failed.size;
    stats.updatedAt = new Date().toISOString();
    await mkdir(dirnameOf(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify({
      name,
      completed: [...completed],
      failed: Object.fromEntries(failed),
      stats,
    })}\n`, "utf8");
  }

  function dirnameOf(file) {
    const index = file.lastIndexOf("/");
    return index > 0 ? file.slice(0, index) : ".";
  }

  function maybeProgress() {
    const now = Date.now();
    if (
      stats.completedItems - lastProgressCount >= progressEveryItems
      || now - lastProgressAt >= progressEveryMs
    ) {
      onLog(
        `进度 ${stats.completedItems}/${stats.totalItems}（失败 ${failed.size}，`
        + `调用 ${stats.calls}，输入 ${stats.promptTokens} token，`
        + `输出 ${stats.completionTokens} token）`,
      );
      lastProgressAt = now;
      lastProgressCount = stats.completedItems;
    }
  }

  async function runItem(item, attempts, onResult) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const { usage, calls = 1, result } = await item.run(attempt);
        await mkdir(dirnameOf(resultPathFor(item.key)), { recursive: true });
        await writeFile(
          resultPathFor(item.key),
          `${JSON.stringify(result)}\n`,
          "utf8",
        );
        completed.add(item.key);
        failed.delete(item.key);
        stats.completedItems += 1;
        stats.calls += calls;
        stats.promptTokens += usage?.promptTokens ?? 0;
        stats.completionTokens += usage?.completionTokens ?? 0;
        await save();
        maybeProgress();
        onResult?.({ key: item.key, ok: true, result });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= attempts) {
          failed.set(item.key, {
            attempts: (failed.get(item.key)?.attempts ?? 0) + 1,
            message: message.slice(0, 500),
            at: new Date().toISOString(),
          });
          stats.calls += 1;
          await save();
          maybeProgress();
          onResult?.({ key: item.key, ok: false, error: message });
          onLog(`失败 ${item.key}：${message.slice(0, 160)}`);
        } else {
          onLog(`重试 ${item.key}（第 ${attempt} 次失败）：${message.slice(0, 120)}`);
          await sleep(800 * attempt);
        }
      }
    }
  }

  /**
   * 主跑：items 为 { key, run }；run 返回 { usage?, result }。
   * 第一轮完成后自动重跑失败队列（最多额外 2 轮）。
   */
  async function runAll(items, { onResult } = {}) {
    await load();
    stats.totalItems = items.length;
    const pending = items.filter((item) =>
      !completed.has(item.key) && !failed.has(item.key));
    onLog(
      `共 ${items.length} 项；已完成 ${completed.size}，`
      + `待处理 ${pending.length}，曾失败 ${failed.size}`,
    );

    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= pending.length) return;
        await runItem(pending[index], perItemAttempts, onResult);
      }
    }
    const workerCount = Math.max(1, Math.min(maxConcurrent, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    for (let round = 1; round <= 2; round += 1) {
      const retryItems = items.filter((item) => failed.has(item.key));
      if (!retryItems.length) break;
      onLog(`失败队列第 ${round} 轮重试：${retryItems.length} 项`);
      cursor = 0;
      async function retryWorker() {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= retryItems.length) return;
          await runItem(retryItems[index], 1, onResult);
        }
      }
      const retryCount = Math.max(1, Math.min(maxConcurrent, retryItems.length));
      await Promise.all(Array.from({ length: retryCount }, () => retryWorker()));
    }

    stats.finished = true;
    await save();
    maybeProgress();
    onLog(
      `完成：${stats.completedItems}/${stats.totalItems}；仍失败 ${failed.size}；`
      + `调用 ${stats.calls}；输入 ${stats.promptTokens} token；`
      + `输出 ${stats.completionTokens} token`,
    );
    return { completed, failed, stats };
  }

  /** 重置指定项：从完成/失败集合移除，供重跑修订后的处理逻辑。 */
  async function resetKeys(keys) {
    await load();
    for (const key of keys) {
      completed.delete(key);
      failed.delete(key);
    }
    await save();
  }

  return { load, save, runAll, resetKeys, getStats: () => stats };
}
