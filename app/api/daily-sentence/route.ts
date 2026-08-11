import { NextRequest, NextResponse } from "next/server";
import {
  ApiRequestError,
  beginApiRequest,
  readJsonBody,
} from "../../../lib/api-guard";
import {
  chatCompletion,
  getProviderConfig,
  parseJsonContent,
  withRetry,
} from "../../../lib/ai-provider";
import {
  isDailySentenceLocalDate,
  normalizeDailySentenceContent,
  type DailySentenceInput,
} from "../../../lib/daily-sentence";

type DailySentenceRequest = {
  localDate?: unknown;
};

function normalizeRequest(value: unknown): DailySentenceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as DailySentenceRequest;
  if (
    Object.keys(item).length !== 1
    || !Object.hasOwn(item, "localDate")
    || !isDailySentenceLocalDate(item.localDate)
  ) return null;
  return { localDate: item.localDate };
}

async function handlePost(request: NextRequest) {
  const input = normalizeRequest(
    await readJsonBody<DailySentenceRequest>(request, 8 * 1024),
  );
  if (!input) {
    return NextResponse.json(
      { error: "本地日期或请求结构无效" },
      { status: 400 },
    );
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，暂时无法生成今日长难句" },
      { status: 503 },
    );
  }

  try {
    return await withRetry(2, async () => {
      const content = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是谨慎的考研英语原创长难句编辑。生成一条 30–70 个英文词的完整原创长难句；内容不是历年真题、教材原文或权威语料，禁止引用、拼接或仿写到近似复现受版权保护的原句。返回准确的中文译文、可连续映射回原句的主干、2–8 个从句结构和 1–12 个修饰关系。clauses 每项为 { text, type, function }，type 只能是 main、relative、noun、adverbial、appositive、coordinate、other，且至少一个 main 和一个非 main；modifiers 每项为 { text, target, relation }。只返回 JSON object，不要 Markdown、HTML 或额外说明；结构固定为 { sentence, backbone, clauses, modifiers, translation }。",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
        temperature: 0.35,
        maxTokens: 1_800,
        timeoutMs: 25_000,
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
        maxBytes: 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      if (!content) throw new Error("模型没有返回内容");
      const normalized = normalizeDailySentenceContent(
        parseJsonContent(content),
        input,
      );
      if (!normalized) throw new Error("模型返回的长难句结构不完整");
      return NextResponse.json(normalized);
    });
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    console.error(
      "[api/daily-sentence] 每日长难句生成失败",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { error: "AI 原创长难句生成失败，请稍后重试；已有合法缓存不会被覆盖" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "daily-sentence",
      requestsPerMinute: 10,
      maxConcurrent: 2,
    });
    return await handlePost(request);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  } finally {
    lease?.release();
  }
}
