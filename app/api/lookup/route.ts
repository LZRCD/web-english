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

type LookupRequest = {
  text?: string;
  context?: string;
};

type LookupPayload = {
  query?: unknown;
  kind?: unknown;
  part?: unknown;
  meaning?: unknown;
  note?: unknown;
};

function normalizeLookup(payload: LookupPayload, query: string) {
  if (
    typeof payload.meaning !== "string"
    || !payload.meaning.trim()
    || typeof payload.part !== "string"
    || !payload.part.trim()
  ) {
    throw new Error("模型返回的查词字段不完整");
  }
  const kind = payload.kind === "phrase" || payload.kind === "sentence"
    ? payload.kind
    : "word";
  return {
    query: boundedText(payload.query, 160)
      ? boundedText(payload.query, 160)
      : query,
    kind,
    phonetic: "",
    part: boundedText(payload.part, 32),
    meaning: boundedText(payload.meaning, 200),
    note: boundedText(payload.note, 200),
    source: "ai" as const,
  };
}

async function handlePost(request: NextRequest) {
  const body = await readJsonBody<LookupRequest>(request, 16 * 1024);

  const text = boundedText(body.text, 160);
  const context = boundedText(body.context, 500);
  if (!text || !/[A-Za-z]/.test(text)) {
    return NextResponse.json({ error: "请选择英文单词、短语或句子" }, { status: 400 });
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json({ error: "未配置 DeepSeek API" }, { status: 503 });
  }

  try {
    return await withRetry(2, async () => {
      const content = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是严谨、简洁的英语词典编辑。只返回 JSON，字段必须是 query、kind、part、meaning、note，不要生成 phonetic 或任何音标字段。kind 只能是 word、phrase 或 sentence。单词需给出词性；短语或句子的 part 分别写“短语”或“句子”。meaning 用中文给出当前语境下最准确的含义，不超过 60 字；note 用一句话说明搭配、语气或语法，不超过 70 字。必须优先依据 context 判断词义，不捏造词源。",
          },
          {
            role: "user",
            content: JSON.stringify({ text, context }),
          },
        ],
        temperature: 0.1,
        maxTokens: 360,
        timeoutMs: 12000,
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
        maxBytes: 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      if (!content) throw new Error("模型没有返回内容");
      return NextResponse.json(normalizeLookup(parseJsonContent<LookupPayload>(content), text));
    });
  } catch (lastError) {
    console.error("[api/lookup] 划词查询失败", lastError);
    return NextResponse.json({ error: "划词查询失败，请重新选择" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "lookup",
      requestsPerMinute: 40,
      maxConcurrent: 4,
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
