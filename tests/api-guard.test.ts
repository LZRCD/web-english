import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../lib/api-guard.ts";

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
