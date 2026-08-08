import { NextRequest, NextResponse } from "next/server";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../../../../lib/api-guard";
import {
  chatCompletion,
  getProviderConfig,
  parseJsonContent,
} from "../../../../lib/ai-provider";

type ReviewRequest = {
  word?: string;
  meaning?: string;
  sentence?: string;
  translation?: string;
  reason?: "meaning-mismatch" | "low-confidence";
};

type ReviewPayload = {
  matches?: unknown;
  confidence?: unknown;
  note?: unknown;
};

async function handlePost(request: NextRequest) {
  const raw = await readJsonBody<ReviewRequest>(request, 16 * 1024);
  const body = {
    word: boundedText(raw.word, 160),
    meaning: boundedText(raw.meaning, 160),
    sentence: boundedText(raw.sentence, 500),
    translation: boundedText(raw.translation, 300),
    reason: raw.reason === "meaning-mismatch"
      ? "meaning-mismatch"
      : "low-confidence",
  } as const;
  if (!body.word || !body.meaning || !body.sentence || !body.translation) {
    return NextResponse.json({ error: "缺少待审查例句字段" }, { status: 400 });
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json({ error: "未配置云端模型，无法执行语义二审" }, {
      status: 503,
    });
  }
  try {
    const content = await chatCompletion({
      messages: [
        {
          role: "system",
          content: "你是英语词典例句质检员。只返回 JSON：matches（布尔值）、confidence（0到1）、note（不超过60字中文）。判断英文句子是否确实体现指定中文义项，翻译是否与句子一致。不要改写例句。",
        },
        { role: "user", content: JSON.stringify(body) },
      ],
      temperature: 0,
      maxTokens: 180,
      timeoutMs: 12_000,
      thinking: { type: "disabled" },
      responseFormat: { type: "json_object" },
      maxBytes: 512 * 1024,
      errorMessage: (status) => `云端模型返回 ${status}`,
    });
    if (!content) throw new Error("模型没有返回内容");
    const result = parseJsonContent<ReviewPayload>(content);
    if (typeof result.matches !== "boolean") {
      throw new Error("模型未返回审查结论");
    }
    return NextResponse.json({
      matches: result.matches,
      confidence: Number.isFinite(result.confidence)
        ? Math.max(0, Math.min(1, Number(result.confidence)))
        : 0.5,
      note: boundedText(result.note, 200),
    });
  } catch (error) {
    console.error("[api/enrich/review] 语义二审失败", error);
    return NextResponse.json({ error: "语义二审失败，请稍后重试" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "enrich-review",
      requestsPerMinute: 20,
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
