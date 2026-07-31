import { NextRequest, NextResponse } from "next/server";

type EnrichmentRequest = {
  word?: string;
  meaning?: string;
  familiarMeanings?: string[];
  /** 待逐条造句的释义列表 */
  senses?: string[];
};

type SenseExampleItem = {
  meaning?: unknown;
  sentence?: unknown;
  translation?: unknown;
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
  const rawExamples = Array.isArray(enrichment.senseExamples)
    ? enrichment.senseExamples as unknown[]
    : [];
  const senseExamples = rawExamples
    .filter((item): item is SenseExampleItem => Boolean(item) && typeof item === "object")
    .map((item) => ({
      meaning: typeof item.meaning === "string" ? item.meaning.trim() : "",
      sentence: typeof item.sentence === "string" ? item.sentence.trim() : "",
      translation: typeof item.translation === "string"
        ? item.translation.trim()
        : "",
    }))
    .filter((item) => item.meaning && item.sentence && item.translation)
    .slice(0, 8);
  const hasSenseExamples = senseExamples.length > 0;
  const hasLegacySentence = typeof enrichment.sentence === "string"
    && typeof enrichment.translation === "string"
    && Boolean(enrichment.sentence.trim())
    && Boolean(enrichment.translation.trim());
  if (!hasSenseExamples && !hasLegacySentence) {
    throw new Error("模型返回的内容字段不完整");
  }
  if (hasSenseExamples) {
    return {
      sentence: senseExamples[0].sentence,
      translation: senseExamples[0].translation,
      senseExamples,
      collocations,
      source: "ai" as const,
      generatedAt: new Date().toISOString(),
      verified: false,
    };
  }
  return {
    sentence: (enrichment.sentence as string).trim(),
    translation: (enrichment.translation as string).trim(),
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
  const senses = Array.isArray(body.senses)
    ? body.senses
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  if (!senses.length && meaning) {
    senses.push(...meaning.split(/[;；]/).map((item) => item.trim()).filter(Boolean).slice(0, 6));
  }
  const effectiveMeaning = senses.join("；") || meaning || "";
  if (!word || !effectiveMeaning) {
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
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            {
              role: "system",
              content: "你是严谨的考研英语词典编辑。只返回 JSON，不要 markdown。字段必须是 senseExamples、collocations，不要生成 phonetic 或任何音标字段。senseExamples 是数组，必须为 senses 中的每个释义各生成 1 句原创考研阅读风格英文例句，元素为 { meaning, sentence, translation }：meaning 必须与输入 senses 中对应条目逐字一致；sentence 必须准确体现该释义；translation 是对应中文翻译。禁止用 familiarMeanings 中已熟练的含义作为核心义项。collocations 是 2 到 4 个与这些释义相关的常用英文搭配数组。不要捏造词源，不要引用受版权保护的原句。",
            },
            {
              role: "user",
              content: JSON.stringify({
                word,
                senses,
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
        targetMeanings: senses,
      });
    } catch (error) {
      lastError = error;
    }
  }

  console.error("[api/enrich] 内容生成失败", lastError);
  return NextResponse.json({ error: "内容生成失败，请稍后重试" }, { status: 502 });
}
