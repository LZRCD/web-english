import { NextRequest, NextResponse } from "next/server";
import { splitWordSenses } from "../../../lib/word-utils";
import { normalizeSenseExamples } from "../../../lib/enrichment";
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

type EnrichmentRequest = {
  word?: string;
  meaning?: string;
  familiarMeanings?: string[];
  /** 待逐条造句的释义列表 */
  senses?: string[];
  /** 已见例句原文（含本词既有释义例句与其他词的例句），随请求发给模型参考 */
  existingSentences?: string[];
};

/** 逐词生成入口的显式安全上限：覆盖当前最大 17 个义项并留余量。 */
const MAX_SENSES_PER_REQUEST = 18;
/** 已见例句参考上下文上限（参考上下文，不是生成目标，不参与义项截断）。 */
const MAX_EXISTING_SENTENCES = 10;

function normalizeEnrichment(content: string, senses: string[]) {
  const enrichment = parseJsonContent<Record<string, unknown>>(content);
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
        .slice(0, MAX_SENSES_PER_REQUEST)
    : [];
  const existingSentences = Array.isArray(body.existingSentences)
    ? body.existingSentences
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedText(item, 500))
        .filter(Boolean)
        .slice(0, MAX_EXISTING_SENTENCES)
    : [];
  if (!senses.length && meaning) {
    senses.push(...splitWordSenses({ meaning }).slice(0, MAX_SENSES_PER_REQUEST));
  }
  const effectiveMeaning = senses.join("；") || meaning || "";
  if (!word || !effectiveMeaning) {
    return NextResponse.json({ error: "缺少单词或释义" }, { status: 400 });
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，无法生成可靠的内容补充" },
      { status: 503 },
    );
  }

  try {
    return await withRetry(2, async () => {
      const content = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是严谨的考研英语词典编辑。只返回 JSON，不要 markdown。字段必须是 senseExamples、collocations，不要生成 phonetic 或任何音标字段。senseExamples 是数组，必须为 senses 中的每个释义各生成 1 句原创考研阅读风格英文例句，元素为 { meaning, sentence, translation, confidence }：meaning 是例句对应的中文释义；sentence 是英文例句；translation 是例句的中文翻译；confidence 是 0 到 1 的语义匹配置信度。禁止用 familiarMeanings 中已熟练的含义作为核心义项。collocations 是 2 到 4 个与这些释义相关的常用英文搭配数组。不要捏造词源，不要引用受版权保护的原句。",
          },
          {
            role: "user",
            content: JSON.stringify({
              word,
              senses,
              familiarMeanings,
              existingSentences,
            }),
          },
        ],
        temperature: 0.2,
        maxTokens: 1400,
        timeoutMs: 15000,
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
        maxBytes: 2 * 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      if (!content) throw new Error("模型没有返回内容");
      return NextResponse.json({
        ...normalizeEnrichment(content, senses),
        targetMeanings: senses,
      });
    });
  } catch (lastError) {
    console.error("[api/enrich] 内容生成失败", lastError);
    return NextResponse.json({ error: "内容生成失败，请稍后重试" }, { status: 502 });
  }
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
