import { NextRequest, NextResponse } from "next/server";

type CoachRequest = {
  word?: {
    word?: string;
    meaning?: string;
    sentence?: string;
    translation?: string;
    root?: string;
    collocation?: string;
  };
  prompt?: string;
};

function localAnswer(body: CoachRequest) {
  const word = body.word?.word ?? "这个单词";
  const meaning = body.word?.meaning ?? "当前含义";
  const sentence = body.word?.sentence ?? "";
  const prompt = body.prompt ?? "";

  if (prompt.includes("题") || prompt.includes("测")) {
    return `主动回忆：请先不看释义，用 ${word} 完成一句和你今天有关的话。然后回答：它在 “${sentence}” 中表达的核心含义是什么？`;
  }
  if (prompt.includes("近义") || prompt.includes("区别")) {
    return `${word} 的关键语义是“${meaning}”。辨析近义词时，先比较使用场景、语气强弱和常见搭配；这里的原句 “${sentence}” 就是最可靠的语境锚点。`;
  }
  if (prompt.includes("语境") || prompt.includes("例句")) {
    return `生活化语境：I noticed the word “${word}” three times today, so I used it in a sentence of my own. 先用英文复述场景，再回想它的核心意思“${meaning}”。`;
  }
  return `记忆联想：把 ${word} 和这条线索绑在一起——${body.word?.root ?? meaning}。再朗读原句 “${sentence}”，让声音、画面和含义同时出现。`;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CoachRequest;
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  if (!apiKey) {
    return NextResponse.json({ answer: localAnswer(body), mode: "local" });
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 260,
        messages: [
          {
            role: "system",
            content: "你是一名简洁、准确的中英双语词汇教练。围绕当前单词，用真实语境、词源联想和主动回忆帮助中文母语学习者。回答不超过180字，不堆砌知识。",
          },
          {
            role: "user",
            content: JSON.stringify(body),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error("AI service unavailable");
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = data.choices?.[0]?.message?.content?.trim();
    return NextResponse.json({ answer: answer || localAnswer(body), mode: "cloud" });
  } catch {
    return NextResponse.json({ answer: localAnswer(body), mode: "local" });
  }
}
