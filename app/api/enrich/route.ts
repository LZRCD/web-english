import { NextRequest, NextResponse } from "next/server";

type EnrichmentRequest = {
  word?: string;
  meaning?: string;
  familiarMeanings?: string[];
};

const MAX_ATTEMPTS = 2;

function parseJsonContent(value: string) {
  const normalized = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(normalized) as Record<string, unknown>;
}

function normalizeEnrichment(content: string) {
  const enrichment = parseJsonContent(content);
  const collocations = Array.isArray(enrichment.collocations)
    ? enrichment.collocations
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  if (
    typeof enrichment.sentence !== "string"
    || typeof enrichment.translation !== "string"
    || !enrichment.sentence.trim()
    || !enrichment.translation.trim()
    || collocations.length < 2
  ) {
    throw new Error("模型返回的内容字段不完整");
  }
  return {
    sentence: enrichment.sentence.trim(),
    translation: enrichment.translation.trim(),
    collocations,
    source: "ai" as const,
    generatedAt: new Date().toISOString(),
    verified: false,
  };
}

export async function POST(request: NextRequest) {
  let body: EnrichmentRequest;
  try {
    body = await request.json() as EnrichmentRequest;
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }
  const word = body.word?.trim();
  const meaning = body.meaning?.trim();
  const familiarMeanings = Array.isArray(body.familiarMeanings)
    ? body.familiarMeanings
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  if (!word || !meaning) {
    return NextResponse.json({ error: "缺少单词或释义" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，无法生成可靠的内容补充" },
      { status: 503 },
    );
  }
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.OPENAI_MODEL ?? "deepseek-v4-flash";

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 420,
          messages: [
            {
              role: "system",
              content: "你是严谨的考研英语词典编辑。只返回 JSON，不要 markdown。字段必须是 sentence、translation、collocations，不要生成 phonetic 或任何音标字段。sentence 是原创的考研阅读风格英文例句，必须准确体现 redbookMeaning 中尚未熟练的中文释义，禁止用 familiarMeanings 中已熟练的含义作为核心义项；translation 是对应中文翻译；collocations 是 2 到 4 个与未熟练义项相关的常用英文搭配数组。不要捏造词源，不要引用受版权保护的原句。",
            },
            {
              role: "user",
              content: JSON.stringify({
                word,
                redbookMeaning: meaning,
                familiarMeanings,
              }),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`云端模型返回 ${response.status}`);
      }
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("模型没有返回内容");
      return NextResponse.json({
        ...normalizeEnrichment(content),
        targetMeanings: meaning.split(/[;；]/).map((item) => item.trim()).filter(Boolean),
      });
    } catch (error) {
      lastError = error;
    }
  }

  console.error("[api/enrich] 内容生成失败", lastError);
  return NextResponse.json({ error: "内容生成失败，请稍后重试" }, { status: 502 });
}
