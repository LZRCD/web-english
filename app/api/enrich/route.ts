import { NextRequest, NextResponse } from "next/server";

type EnrichmentRequest = {
  word?: string;
  meaning?: string;
};

function parseJsonContent(value: string) {
  const normalized = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(normalized) as Record<string, unknown>;
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

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content: "你是严谨的考研英语词典编辑。只返回 JSON，不要 markdown。字段必须是 phonetic、sentence、translation、collocations。phonetic 使用美式 IPA 并带斜杠；sentence 是原创的考研阅读风格英文例句，必须准确体现用户给出的中文释义；translation 是对应中文翻译；collocations 是 2 到 4 个常用英文搭配数组。不要捏造词源，不要引用受版权保护的原句。",
          },
          {
            role: "user",
            content: JSON.stringify({ word, redbookMeaning: meaning }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("AI service unavailable");
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty response");
    const enrichment = parseJsonContent(content);
    const collocations = Array.isArray(enrichment.collocations)
      ? enrichment.collocations.filter((item): item is string => typeof item === "string").slice(0, 4)
      : [];
    if (
      typeof enrichment.phonetic !== "string"
      || typeof enrichment.sentence !== "string"
      || typeof enrichment.translation !== "string"
      || collocations.length < 2
    ) {
      throw new Error("invalid enrichment");
    }
    return NextResponse.json({
      phonetic: enrichment.phonetic.trim(),
      sentence: enrichment.sentence.trim(),
      translation: enrichment.translation.trim(),
      collocations: collocations.map((item) => item.trim()).filter(Boolean),
      source: "ai",
      generatedAt: new Date().toISOString(),
      verified: false,
    });
  } catch {
    return NextResponse.json({ error: "内容生成失败，请稍后重试" }, { status: 502 });
  }
}
