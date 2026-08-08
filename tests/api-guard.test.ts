import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../lib/api-guard.ts";
import {
  chatCompletion,
  getProviderConfig,
  parseJsonContent,
  withRetry,
} from "../lib/ai-provider.ts";

test("请求体在 JSON 解析前按字节上限拒绝", async () => {
  const declared = new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Length": "999" },
    body: "{}",
  });
  await assert.rejects(
    () => readJsonBody(declared, 100),
    (error: unknown) => error instanceof ApiRequestError && error.status === 413,
  );

  const streamed = new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify({ text: "超".repeat(100) }),
  });
  await assert.rejects(
    () => readJsonBody(streamed, 64),
    (error: unknown) => error instanceof ApiRequestError && error.status === 413,
  );
});

test("统一文本边界折叠空白并限制长度", () => {
  assert.equal(boundedText("  one\n two  ", 7), "one two");
  assert.equal(boundedText("abcdefgh", 4), "abcd");
  assert.equal(boundedText(42, 10), "");
});

test("接口守卫拒绝跨来源、超频和超过并发上限", () => {
  assert.throws(
    () => beginApiRequest(new Request("http://localhost/api", {
      headers: { Origin: "https://example.test" },
    }), {
      name: "origin-test",
      requestsPerMinute: 10,
      maxConcurrent: 1,
    }),
    (error: unknown) => error instanceof ApiRequestError && error.status === 403,
  );

  const request = new Request("http://localhost/api", {
    headers: { Origin: "http://localhost" },
  });
  const lease = beginApiRequest(request, {
    name: "concurrency-test",
    requestsPerMinute: 10,
    maxConcurrent: 1,
  });
  assert.throws(
    () => beginApiRequest(request, {
      name: "concurrency-test",
      requestsPerMinute: 10,
      maxConcurrent: 1,
    }),
    (error: unknown) => error instanceof ApiRequestError && error.status === 429,
  );
  lease.release();

  const first = beginApiRequest(request, {
    name: "rate-test",
    requestsPerMinute: 1,
    maxConcurrent: 2,
  });
  first.release();
  assert.throws(
    () => beginApiRequest(request, {
      name: "rate-test",
      requestsPerMinute: 1,
      maxConcurrent: 2,
    }),
    (error: unknown) => error instanceof ApiRequestError && error.status === 429,
  );
});

// ---- lib/ai-provider.ts 唯一实现 ----

/** 临时设置环境变量与 fetch 实现，测试结束后恢复（不发起真实网络请求） */
async function withProviderMocks(
  env: Record<string, string>,
  fetchImpl: typeof fetch,
  run: () => Promise<void>,
) {
  const savedEnv = new Map(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  try {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    globalThis.fetch = fetchImpl;
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** 仅备份并恢复环境变量（供 getProviderConfig 纯函数测试使用） */
async function withSavedEnv(run: () => Promise<void>) {
  const keys = [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
  ] as const;
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Provider 环境变量读取回退到默认值", async () => {
  await withSavedEnv(async () => {
    assert.deepEqual(getProviderConfig(), {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });

    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_BASE_URL = "https://openai.example/";
    process.env.OPENAI_MODEL = "gpt-test";
    assert.deepEqual(getProviderConfig(), {
      apiKey: "openai-key",
      baseUrl: "https://openai.example/",
      model: "gpt-test",
    });

    process.env.DEEPSEEK_API_KEY = "deepseek-key";
    assert.equal(getProviderConfig().apiKey, "deepseek-key");
  });
});

test("parseJsonContent 清理 Markdown 围栏并解析 JSON", () => {
  assert.deepEqual(parseJsonContent('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonContent('```\n{"b": 2}\n```'), { b: 2 });
  assert.deepEqual(parseJsonContent('{"c": [1, 2]}'), { c: [1, 2] });
  assert.throws(() => parseJsonContent("not json"));
});

test("chatCompletion 构造请求体、携带超时信号并提取 choices 内容", async () => {
  const captured: { url?: string; init?: RequestInit } = {};
  await withProviderMocks(
    {
      DEEPSEEK_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.deepseek.com/",
      OPENAI_MODEL: "deepseek-v4-flash",
    },
    (async (input, init) => {
      captured.url = String(input);
      captured.init = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
        { status: 200 },
      );
    }) as typeof fetch,
    async () => {
      const content = await chatCompletion({
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.2,
        maxTokens: 100,
        timeoutMs: 12345,
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
        maxBytes: 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      assert.equal(content, "{\"ok\":true}");
      assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
      assert.ok(captured.init?.signal instanceof AbortSignal);
      assert.equal(
        new Headers(captured.init?.headers ?? {}).get("Authorization"),
        "Bearer test-key",
      );
      assert.deepEqual(JSON.parse(String(captured.init?.body)), {
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 100,
        messages: [{ role: "user", content: "hello" }],
      });
    },
  );
});

test("chatCompletion 不传 thinking/response_format 时请求体不含这两个字段", async () => {
  const captured: { init?: RequestInit } = {};
  await withProviderMocks(
    {
      DEEPSEEK_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.deepseek.com",
    },
    (async (_input, init) => {
      captured.init = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "x" } }] }),
        { status: 200 },
      );
    }) as typeof fetch,
    async () => {
      const content = await chatCompletion({
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.7,
        maxTokens: 260,
        timeoutMs: 15000,
        maxBytes: 1024 * 1024,
        errorMessage: () => "AI service unavailable",
      });
      assert.equal(content, "x");
      assert.deepEqual(JSON.parse(String(captured.init?.body)), {
        model: "deepseek-v4-flash",
        temperature: 0.7,
        max_tokens: 260,
        messages: [{ role: "user", content: "hello" }],
      });
    },
  );
});

test("chatCompletion 提取 choices 内容，缺失时返回 undefined", async () => {
  await withProviderMocks(
    { DEEPSEEK_API_KEY: "test-key" },
    (async () => new Response(
      JSON.stringify({ choices: [{ message: {} }] }),
      { status: 200 },
    )) as typeof fetch,
    async () => {
      const content = await chatCompletion({
        messages: [],
        temperature: 0.2,
        maxTokens: 100,
        timeoutMs: 1000,
        maxBytes: 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      assert.equal(content, undefined);
    },
  );
});

test("chatCompletion 非 2xx 抛错且错误文案由调用方决定", async () => {
  await withProviderMocks(
    { DEEPSEEK_API_KEY: "test-key" },
    (async () => new Response("错误", { status: 502 })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => chatCompletion({
          messages: [],
          temperature: 0.1,
          maxTokens: 360,
          timeoutMs: 12000,
          maxBytes: 1024 * 1024,
          errorMessage: (status) => `云端模型返回 ${status}`,
        }),
        /云端模型返回 502/,
      );
      await assert.rejects(
        () => chatCompletion({
          messages: [],
          temperature: 0.7,
          maxTokens: 260,
          timeoutMs: 15000,
          maxBytes: 1024 * 1024,
          errorMessage: () => "AI service unavailable",
        }),
        /AI service unavailable/,
      );
    },
  );
});

test("chatCompletion 响应超过 maxBytes 上限时拒绝", async () => {
  await withProviderMocks(
    { DEEPSEEK_API_KEY: "test-key" },
    (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "x".repeat(100) } }] }),
      { status: 200 },
    )) as typeof fetch,
    async () => {
      await assert.rejects(
        () => chatCompletion({
          messages: [],
          temperature: 0.2,
          maxTokens: 100,
          timeoutMs: 1000,
          maxBytes: 32,
          errorMessage: (status) => `云端模型返回 ${status}`,
        }),
        (error: unknown) => error instanceof ApiRequestError && error.status === 413,
      );
    },
  );
});

test("withRetry 首次失败后重试成功", async () => {
  let calls = 0;
  const result = await withRetry(2, async () => {
    calls += 1;
    if (calls === 1) throw new Error("第一次失败");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry 全部失败时抛出最后一次错误", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(2, async () => {
      calls += 1;
      throw new Error(`第 ${calls} 次失败`);
    }),
    /第 2 次失败/,
  );
  assert.equal(calls, 2);
});
