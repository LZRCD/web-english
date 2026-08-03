import { NextRequest, NextResponse } from "next/server";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../../../../lib/api-guard";

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

function parseJsonContent(value: string) {
  return JSON.parse(value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()) as ReviewPayload;
}

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

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "未配置云端模型，无法执行语义二审" }, {
      status: 503,
    });
  }
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.OPENAI_MODEL ?? "deepseek-v4-flash";
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content: "你是英语词典例句质检员。只返回 JSON：matches（布尔值）、confidence（0到1）、note（不超过60字中文）。判断英文句子是否确实体现指定中文义项，翻译是否与句子一致。不要改写例句。",
          },
          { role: "user", content: JSON.stringify(body) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`云端模型返回 ${response.status}`);
    const data = await readJsonBody<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(response, 512 * 1024);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型没有返回内容");
    const result = parseJsonContent(content);
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
