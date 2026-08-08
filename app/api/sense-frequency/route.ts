import { NextRequest, NextResponse } from "next/server";
import { normalizeSenseFrequency } from "../../../lib/sense-frequency";
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

type SenseFrequencyRequest = {
  word?: string;
  /** 待标注考频的义项列表 */
  senses?: string[];
};

async function handlePost(request: NextRequest) {
  const body = await readJsonBody<SenseFrequencyRequest>(request, 32 * 1024);
  const word = boundedText(body.word, 160);
  const senses = Array.isArray(body.senses)
    ? body.senses
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedText(item, 160))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  if (!word || senses.length < 2) {
    return NextResponse.json({ error: "需要多义词及其至少两个义项" }, { status: 400 });
  }

  const { apiKey } = getProviderConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置云端模型，暂以义项编号提示为主" },
      { status: 503 },
    );
  }

  try {
    return await withRetry(2, async () => {
      const content = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是严谨的考研英语词义考频编辑。只返回 JSON，不要 markdown。字段必须是 senses。senses 是数组，必须为输入 senses 中的每个释义各返回一个元素 { meaning, level, note }：meaning 必须与输入逐字一致；level 只能是 high（考研真题高频常考义，需重点记）、medium（中频）、low（低频少见）之一；note 是一句简短中文提示（不超过 20 字），可说明如“真题常考熟词僻义”“阅读中常见”等。不要捏造词源。"
          },
          {
            role: "user",
            content: JSON.stringify({ word, senses }),
          },
        ],
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 20000,
        thinking: { type: "disabled" },
        responseFormat: { type: "json_object" },
        maxBytes: 2 * 1024 * 1024,
        errorMessage: (status) => "云端模型返回 " + status,
      });
      if (!content) throw new Error("模型没有返回内容");
      const result = normalizeSenseFrequency(parseJsonContent(content), senses);
      return NextResponse.json({ senses: result });
    });
  } catch (lastError) {
    console.error("[api/sense-frequency] 义项考频生成失败", lastError);
    return NextResponse.json({ error: "义项考频生成失败，请稍后重试" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "sense-frequency",
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
