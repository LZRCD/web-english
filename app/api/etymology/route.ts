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
import { normalizeEtymologyContent } from "../../../lib/etymology";

type EtymologyRequest = {
  word?: string;
  meaning?: string;
  root?: string;
  relation?: {
    kind?: string;
    label?: string;
    note?: string;
    lemma?: string;
    independent?: boolean;
    confidence?: string;
  };
};

const RELATION_KINDS = new Set([
  "grammar",
  "lexicalized",
  "pronoun",
  "derived",
  "contrast",
  "inflection",
  "variant",
]);

function normalizeRelation(value: EtymologyRequest["relation"]) {
  if (!value) return undefined;
  const kind = boundedText(value.kind, 30);
  const confidence = boundedText(value.confidence, 30);
  return {
    kind: RELATION_KINDS.has(kind) ? kind : "",
    label: boundedText(value.label, 160),
    note: boundedText(value.note, 300),
    lemma: boundedText(value.lemma, 160),
    independent: value.independent === true,
    confidence: confidence === "confirmed" || confidence === "source-confirmed"
      ? confidence
      : "",
  };
}

async function handlePost(request: NextRequest) {
  const raw = await readJsonBody<EtymologyRequest>(request, 32 * 1024);
  const body = {
    word: boundedText(raw.word, 160),
    meaning: boundedText(raw.meaning, 1_000),
    root: boundedText(raw.root, 160),
    relation: normalizeRelation(raw.relation),
  };
  if (!body.word || !body.meaning) {
    return NextResponse.json({ error: "缺少单词或释义" }, { status: 400 });
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，已保留本地词根与词族线索" },
      { status: 503 },
    );
  }

  try {
    return await withRetry(2, async () => {
      const content = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是谨慎的英语构词助记编辑。内容只用于记忆联想，不是权威历史词源考据。输入中的 root 和 relation 是本地真实线索，必须遵守且不得冲突；不确定历史来源时，只做词形拆解和记忆联想，不得捏造年代、语言来源或学术结论。只返回 JSON object，不要 Markdown，字段必须是 breakdown、root、affixes、mnemonic。affixes 是数组，每项为 { form, kind, meaning }，kind 只能是 prefix、root、suffix、other。不得引用或改写受版权保护的教材原句。",
          },
          {
            role: "user",
            content: JSON.stringify(body),
          },
        ],
        temperature: 0.2,
        maxTokens: 900,
        timeoutMs: 20_000,
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
        maxBytes: 2 * 1024 * 1024,
        errorMessage: (status) => `云端模型返回 ${status}`,
      });
      if (!content) throw new Error("模型没有返回内容");
      const normalized = normalizeEtymologyContent(parseJsonContent(content));
      if (!normalized) throw new Error("模型返回的词根助记结构不完整");
      return NextResponse.json(normalized);
    });
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    console.error(
      "[api/etymology] 词根助记生成失败",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { error: "AI 词根助记生成失败，请稍后重试；本地线索仍会保留" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "etymology",
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
