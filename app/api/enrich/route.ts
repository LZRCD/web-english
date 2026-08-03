import { NextRequest, NextResponse } from "next/server";
import { normalizeSenseExamples } from "../../../lib/enrichment";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../../../lib/api-guard";

type EnrichmentRequest = {
  word?: string;
  meaning?: string;
  familiarMeanings?: string[];
  /** 待逐条造句的释义列表 */
  senses?: string[];
};

const MAX_ATTEMPTS = 2;

function parseJsonContent(value: string) {
  const normalized = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(normalized) as Record<string, unknown>;
}

function normalizeEnrichment(content: string, senses: string[]) {
  const enrichment = parseJsonContent(content);
  const collocations = Array.isArray(enrichment.collocations)
    ? enrichment.collocations
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedText(item, 100))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const senseExamples = normalizeSenseExamples(
    enrichment.senseExamples,
    senses,
  );
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

async function handlePost(request: NextRequest) {
  const body = await readJsonBody<EnrichmentRequest>(request, 32 * 1024);
  const word = boundedText(body.word, 160);
  const meaning = boundedText(body.meaning, 1_000);
  const familiarMeanings = Array.isArray(body.familiarMeanings)
    ? body.familiarMeanings
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedText(item, 160))
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const senses = Array.isArray(body.senses)
    ? body.senses
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedText(item, 160))
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
              content: "你是严谨的考研英语词典编辑。只返回 JSON，不要 markdown。字段必须是 senseExamples、collocations，不要生成 phonetic 或任何音标字段。senseExamples 是数组，必须为 senses 中的每个释义各生成 1 句原创考研阅读风格英文例句，元素为 { meaning, sentence, translation, confidence }：meaning 必须与输入 senses 中对应条目逐字一致；sentence 必须准确体现该释义；translation 是对应中文翻译；confidence 是 0 到 1 的语义匹配置信度。禁止用 familiarMeanings 中已熟练的含义作为核心义项。collocations 是 2 到 4 个与这些释义相关的常用英文搭配数组。不要捏造词源，不要引用受版权保护的原句。",
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
      const data = await readJsonBody<{
        choices?: Array<{ message?: { content?: string } }>;
      }>(response, 2 * 1024 * 1024);
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("模型没有返回内容");
      return NextResponse.json({
        ...normalizeEnrichment(content, senses),
        targetMeanings: senses,
      });
    } catch (error) {
      lastError = error;
    }
  }

  console.error("[api/enrich] 内容生成失败", lastError);
  return NextResponse.json({ error: "内容生成失败，请稍后重试" }, { status: 502 });
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "enrich",
      requestsPerMinute: 20,
      maxConcurrent: 3,
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
