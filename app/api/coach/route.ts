import { NextRequest, NextResponse } from "next/server";
import {
  ApiRequestError,
  beginApiRequest,
  boundedText,
  readJsonBody,
} from "../../../lib/api-guard";
import { chatCompletion, getProviderConfig } from "../../../lib/ai-provider";

type CoachRequest = {
  word?: {
    word?: string;
    meaning?: string;
    sentence?: string;
    translation?: string;
    root?: string;
    collocation?: string;
    section?: string;
    unit?: number | string;
    relation?: {
      label?: string;
      note?: string;
      independent?: boolean;
    };
  };
  prompt?: string;
};

function localAnswer(body: CoachRequest) {
  const word = body.word?.word ?? "这个单词";
  const meaning = body.word?.meaning ?? "当前含义";
  const sentence = body.word?.sentence ?? "请结合考研阅读语境造句";
  const prompt = body.prompt ?? "";
  const relationHint = body.word?.relation?.label
    ? `词族提示：${body.word.relation.label}。${body.word.relation.note ?? ""}`
    : "";

  if (prompt.includes("题") || prompt.includes("测")) {
    return `${relationHint}主动回忆：请先不看释义，用 ${word} 完成一句和你今天有关的话。然后回答：它在 “${sentence}” 中表达的核心含义是什么？`;
  }
  if (prompt.includes("近义") || prompt.includes("区别")) {
    return `${relationHint}${word} 的关键语义是“${meaning}”。辨析近义词时，先比较使用场景、语气强弱和常见搭配；这里的原句 “${sentence}” 就是最可靠的语境锚点。`;
  }
  if (prompt.includes("语境") || prompt.includes("例句")) {
    return `${relationHint}生活化语境：I noticed the word “${word}” three times today, so I used it in a sentence of my own. 先用英文复述场景，再回想它的核心意思“${meaning}”。`;
  }
  return `${relationHint}记忆联想：把 ${word} 和这条线索绑在一起——${body.word?.root ?? meaning}。再朗读原句 “${sentence}”，让声音、画面和含义同时出现。`;
}

async function handlePost(request: NextRequest) {
  const raw = await readJsonBody<CoachRequest>(request, 32 * 1024);
  const body: CoachRequest = {
    prompt: boundedText(raw.prompt, 500),
    word: raw.word ? {
      word: boundedText(raw.word.word, 160),
      meaning: boundedText(raw.word.meaning, 1_000),
      sentence: boundedText(raw.word.sentence, 1_000),
      translation: boundedText(raw.word.translation, 1_000),
      root: boundedText(raw.word.root, 300),
      collocation: boundedText(raw.word.collocation, 500),
      section: boundedText(raw.word.section, 50),
      unit: typeof raw.word.unit === "number"
        ? raw.word.unit
        : boundedText(raw.word.unit, 30),
      relation: raw.word.relation ? {
        label: boundedText(raw.word.relation.label, 160),
        note: boundedText(raw.word.relation.note, 300),
        independent: raw.word.relation.independent === true,
      } : undefined,
    } : undefined,
  };
  if (!body.word?.word || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "缺少当前单词或问题" }, { status: 400 });
  }
  const { apiKey } = getProviderConfig();

  if (!apiKey) {
    return NextResponse.json({ answer: localAnswer(body), mode: "local", reason: "missing_key" });
  }

  try {
    const content = await chatCompletion({
      messages: [
        {
          role: "system",
          content: "你是一名简洁、准确的考研英语词汇教练。围绕2027考研英语红宝书当前单词，用考研阅读语境、熟词僻义、词根联想、近义词辨析和主动回忆帮助中文母语学习者。若输入含人工确认的 relation，必须遵守该关系，不把独立词义误判成普通词形变化。回答不超过180字，不照抄教材，不堆砌知识。",
        },
        {
          role: "user",
          content: JSON.stringify(body),
        },
      ],
      temperature: 0.7,
      maxTokens: 260,
      timeoutMs: 15000,
      maxBytes: 1024 * 1024,
      errorMessage: () => "AI service unavailable",
    });
    const answer = boundedText(content, 500, false);
    return NextResponse.json({ answer: answer || localAnswer(body), mode: "cloud" });
  } catch {
    return NextResponse.json({ answer: localAnswer(body), mode: "local", reason: "upstream_error" });
  }
}

export async function POST(request: NextRequest) {
  let lease: ReturnType<typeof beginApiRequest> | undefined;
  try {
    lease = beginApiRequest(request, {
      name: "coach",
      requestsPerMinute: 40,
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
