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

type GuessRequest = {
  word?: string;
  sentence?: string;
  translation?: string;
  /** 单词全部中文义项（判分目标） */
  senses?: string[];
  /** 用户输入的中文猜测 */
  guess?: string;
};

type GuessPayload = {
  correct?: unknown;
  matched?: unknown;
  note?: unknown;
};

async function handlePost(request: NextRequest) {
  const raw = await readJsonBody<GuessRequest>(request, 16 * 1024);
  const body = {
    word: boundedText(raw.word, 160),
    sentence: boundedText(raw.sentence, 500),
    translation: boundedText(raw.translation, 300),
    senses: Array.isArray(raw.senses)
      ? raw.senses
          .filter((item): item is string => typeof item === "string")
          .map((item) => boundedText(item, 160))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    guess: boundedText(raw.guess, 100),
  } as const;
  if (!body.word || !body.senses.length || !body.guess) {
    return NextResponse.json({ error: "缺少单词、义项或猜测内容" }, { status: 400 });
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，无法进行 AI 判分" },
      { status: 503 },
    );
  }

  try {
    const content = await chatCompletion({
      messages: [
        {
          role: "system",
          content: "你是背单词应用的释义判分员。用户看到单词的英文例句后，输入中文猜测该词含义。只返回 JSON：correct（布尔值）、matched（命中的义项，未命中则为空串）、note（不超过40字中文说明）。判定规则：1. 用户输入只要与单词任一义项语义一致（含近义说法、通俗解释）即判 correct=true；2. 不要求与例句语境义一致——用户无需猜中例句用的是哪个义项；3. 单词有多个义项时，命中任何一个都算对；4. 只有输入与全部义项都明显无关时才判 correct=false。matched 必须与输入 senses 列表中的条目逐字一致。",
        },
        { role: "user", content: JSON.stringify(body) },
      ],
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 10_000,
      thinking: { type: "disabled" },
      responseFormat: { type: "json_object" },
      maxBytes: 512 * 1024,
      errorMessage: (status) => `云端模型返回 ${status}`,
    });
    if (!content) throw new Error("模型没有返回内容");
    const result = parseJsonContent<GuessPayload>(content);
    const correct = result.correct === true;
    const matched = typeof result.matched === "string"
      ? boundedText(result.matched, 160)
      : "";
    return NextResponse.json({
      correct,
      // matched 必须落在输入义项列表中，否则置空避免展示错配
      matched: correct && body.senses.includes(matched) ? matched : "",
      note: boundedText(result.note, 200),
    });
  } catch (error) {
    console.error("[api/enrich/guess] AI 判分失败", error);
    return NextResponse.json({ error: "AI 判分失败，请稍后重试" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "enrich-guess",
      requestsPerMinute: 30,
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
