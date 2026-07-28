import { NextRequest, NextResponse } from "next/server";

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

const MAX_ATTEMPTS = 2;

function parseJsonContent(value: string) {
  const normalized = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(normalized) as LookupPayload;
}

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
    query: typeof payload.query === "string" && payload.query.trim()
      ? payload.query.trim()
      : query,
    kind,
    phonetic: "",
    part: payload.part.trim(),
    meaning: payload.meaning.trim(),
    note: typeof payload.note === "string" ? payload.note.trim() : "",
    source: "ai" as const,
  };
}

export async function POST(request: NextRequest) {
  let body: LookupRequest;
  try {
    body = await request.json() as LookupRequest;
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }

  const text = body.text?.replace(/\s+/g, " ").trim().slice(0, 160);
  const context = body.context?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "";
  if (!text || !/[A-Za-z]/.test(text)) {
    return NextResponse.json({ error: "请选择英文单词、短语或句子" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "未配置 DeepSeek API" }, { status: 503 });
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
          temperature: 0.1,
          max_tokens: 360,
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
        }),
      });
      if (!response.ok) throw new Error(`云端模型返回 ${response.status}`);
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("模型没有返回内容");
      return NextResponse.json(normalizeLookup(parseJsonContent(content), text));
    } catch (error) {
      lastError = error;
    }
  }

  console.error("[api/lookup] 划词查询失败", lastError);
  return NextResponse.json({ error: "划词查询失败，请重新选择" }, { status: 502 });
}
