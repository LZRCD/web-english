// lib/ai-provider.ts
// 云端模型 Provider 的唯一实现：7 个 API 路由（coach/enrich/review/lookup/sense-frequency/etymology/daily-cloze）
// 共用的环境变量读取、/chat/completions 请求构造、Markdown JSON 清理、响应提取与重试。
// 各路由保留自己的错误文案、no-key 分支、参数值与日志前缀，行为逐字节与原实现一致。
import { readJsonBody } from "./api-guard.ts";

/** 读取 Provider 环境变量；apiKey 可能为 undefined，由路由决定 no-key 分支 */
export function getProviderConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.OPENAI_MODEL ?? "deepseek-v4-flash",
  };
}

/** 清理模型返回中的 Markdown 代码块围栏后解析 JSON（逐字符保持各路由原实现） */
export function parseJsonContent<T = unknown>(value: string): T {
  const normalized = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(normalized) as T;
}

export type ChatCompletionOptions = {
  messages: unknown[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** 响应体读取上限（原各路由 readJsonBody 的第二参数） */
  maxBytes: number;
  /** 仅当传入时请求体才包含 thinking（coach 原请求体不含该字段） */
  thinking?: { type: "disabled" };
  /** 仅当传入时请求体才包含 response_format（coach 原请求体不含该字段） */
  responseFormat?: { type: "json_object" };
  /** 非 2xx 时的错误文案由调用方决定（各路由原文案逐字保留） */
  errorMessage: (status: number) => string;
};

/**
 * 调用 /chat/completions 并返回 choices[0].message.content；
 * content 缺失时返回 undefined（与各路由原实现保持一致）。
 */
export async function chatCompletion(
  options: ChatCompletionOptions,
): Promise<string | undefined> {
  const { apiKey, baseUrl, model } = getProviderConfig();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      ...(options.thinking ? { thinking: options.thinking } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      messages: options.messages,
    }),
  });
  if (!response.ok) throw new Error(options.errorMessage(response.status));
  const data = await readJsonBody<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(response, options.maxBytes);
  return data.choices?.[0]?.message?.content;
}

/**
 * 按各路由原 MAX_ATTEMPTS 循环的重试语义执行：每次失败吞掉错误后重试，
 * 全部失败时抛出最后一次错误。
 */
export async function withRetry<T>(
  attempts: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
