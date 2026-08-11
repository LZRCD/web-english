import { NextRequest, NextResponse } from "next/server";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../../../lib/api-guard";
import {
  chatCompletion,
  getProviderConfig,
  parseJsonContent,
  withRetry,
} from "../../../lib/ai-provider";
import {
  isDailyClozeLocalDate,
  normalizeDailyClozeContent,
  type DailyClozeInput,
  type DailyClozeTarget,
} from "../../../lib/daily-cloze";

type DailyClozeRequest = {
  localDate?: unknown;
  targets?: unknown;
};

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function boundedRequiredText(value: unknown, maxLength: number) {
  const normalized = boundedText(value, Number.MAX_SAFE_INTEGER);
  if (!normalized || normalized.length > maxLength) return "";
  return boundedText(value, maxLength);
}

function normalizeRequest(value: DailyClozeRequest): DailyClozeInput | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !hasOnlyKeys(value as Record<string, unknown>, ["localDate", "targets"])
    || !isDailyClozeLocalDate(value.localDate)
    || !Array.isArray(value.targets)
    || value.targets.length < 1
    || value.targets.length > 10
  ) return null;
  const targets: DailyClozeTarget[] = [];
  const seen = new Set<number>();
  for (const item of value.targets) {
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
      || !hasOnlyKeys(item as Record<string, unknown>, ["wordId", "word", "meaning"])
    ) return null;
    const target = item as Record<string, unknown>;
    const wordId = target.wordId;
    const word = boundedRequiredText(target.word, 160);
    const meaning = boundedRequiredText(target.meaning, 1_000);
    if (
      typeof wordId !== "number"
      || !Number.isSafeInteger(wordId)
      || wordId <= 0
      || seen.has(wordId)
      || !word
      || !meaning
    ) return null;
    seen.add(wordId);
    targets.push({ wordId, word, meaning });
  }
  return { localDate: value.localDate, targets };
}

async function handlePost(request: NextRequest) {
  const raw = await readJsonBody<DailyClozeRequest>(request, 64 * 1024);
  const input = normalizeRequest(raw);
  if (!input) {
    return NextResponse.json(
      { error: "日期或当天新学词参数无效" },
      { status: 400 },
    );
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，暂时无法生成今日短文" },
      { status: 503 },
    );
  }

  try {
    return await withRetry(2, async () => {
      const content = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是谨慎的考研英语原创短文编辑。根据输入中的全部目标词生成一篇 80–120 个英文词的原创短文；内容不是历年真题、教材原文或权威语料，不得引用、拼接或近似改写受版权保护的教材或真题原句。每个目标词必须按输入拼写在短文中独立出现且只出现一次，并且只作为一道题的答案。每题必须返回 4 个合理、互不重复的英文候选，必须包含目标词原文，并给出简短中文解释。wordId 必须逐字使用输入值，不得创建、替换、遗漏或重排。只返回 JSON object，不要 Markdown、标题或额外说明；结构固定为 { passage, questions: [{ wordId, options, explanation }] }。",
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
        maxBytes: 2 * 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      if (!content) throw new Error("模型没有返回内容");
      const normalized = normalizeDailyClozeContent(
        parseJsonContent(content),
        input,
      );
      if (!normalized) throw new Error("模型返回的短文填词结构不完整");
      return NextResponse.json(normalized);
    });
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    console.error(
      "[api/daily-cloze] 每日短文生成失败",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { error: "AI 原创短文生成失败，请稍后重试；已有合法缓存不会被覆盖" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "daily-cloze",
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
