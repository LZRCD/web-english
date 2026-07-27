"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Word = {
  word: string;
  phonetic: string;
  part: string;
  meaning: string;
  sentence: string;
  translation: string;
  collocation: string;
  root: string;
  family: string;
  level: string;
};

type Review = {
  word: string;
  rating: number;
  nextReview: string;
  reviewedAt: string;
};

const WORDS: Word[] = [
  { word: "resilient", phonetic: "/rɪˈzɪliənt/", part: "adj.", meaning: "有韧性的；能迅速恢复的", sentence: "Children are often more resilient than adults expect.", translation: "孩子往往比成年人想象中更有韧性。", collocation: "a resilient community", root: "re- 回 + salire 跳跃 → 弹回来", family: "resilience · resiliently", level: "CET-6" },
  { word: "subtle", phonetic: "/ˈsʌtl/", part: "adj.", meaning: "微妙的；不易察觉的", sentence: "There was a subtle change in her tone.", translation: "她的语气发生了微妙的变化。", collocation: "a subtle difference", root: "subt 细致 + -le", family: "subtlety · subtly", level: "CET-6" },
  { word: "derive", phonetic: "/dɪˈraɪv/", part: "v.", meaning: "获得；源自；推导", sentence: "Many English words derive from Latin.", translation: "许多英语单词源自拉丁语。", collocation: "derive benefit from", root: "de- 向下 + riv 河流 → 从源头流下", family: "derivation · derivative", level: "CET-4" },
  { word: "coherent", phonetic: "/kəʊˈhɪərənt/", part: "adj.", meaning: "连贯的；一致的", sentence: "She presented a coherent argument.", translation: "她提出了一个连贯的论点。", collocation: "a coherent strategy", root: "co- 共同 + haer 粘住", family: "coherence · coherently", level: "IELTS" },
  { word: "allocate", phonetic: "/ˈæləkeɪt/", part: "v.", meaning: "分配；划拨", sentence: "We need to allocate more time to revision.", translation: "我们需要给复习分配更多时间。", collocation: "allocate resources to", root: "al- 向 + loc 地方 → 放到某处", family: "allocation · allocator", level: "CET-6" },
  { word: "intricate", phonetic: "/ˈɪntrɪkət/", part: "adj.", meaning: "错综复杂的；精细的", sentence: "The watch contains an intricate mechanism.", translation: "这块手表内部有精密复杂的机械结构。", collocation: "intricate details", root: "in- 进入 + tric 纠缠", family: "intricacy · intricately", level: "IELTS" },
  { word: "compelling", phonetic: "/kəmˈpelɪŋ/", part: "adj.", meaning: "令人信服的；引人入胜的", sentence: "The documentary tells a compelling story.", translation: "这部纪录片讲述了一个引人入胜的故事。", collocation: "compelling evidence", root: "com- 共同 + pel 推动", family: "compel · compellingly", level: "CET-6" },
  { word: "diminish", phonetic: "/dɪˈmɪnɪʃ/", part: "v.", meaning: "减少；削弱", sentence: "The pain gradually began to diminish.", translation: "疼痛逐渐开始减轻。", collocation: "diminish the impact", root: "di- 分开 + min 小", family: "diminution · diminished", level: "CET-6" },
  { word: "ambiguous", phonetic: "/æmˈbɪɡjuəs/", part: "adj.", meaning: "模棱两可的；含糊的", sentence: "The final sentence is deliberately ambiguous.", translation: "最后一句话是故意写得模棱两可的。", collocation: "an ambiguous statement", root: "ambi- 两边 + ag 行动", family: "ambiguity · ambiguously", level: "IELTS" },
  { word: "sustain", phonetic: "/səˈsteɪn/", part: "v.", meaning: "维持；支撑；承受", sentence: "Small habits sustain long-term progress.", translation: "小习惯能够维持长期进步。", collocation: "sustain growth", root: "sus- 在下 + tain 持有", family: "sustainable · sustainability", level: "CET-4" },
  { word: "inevitable", phonetic: "/ɪnˈevɪtəbl/", part: "adj.", meaning: "不可避免的", sentence: "Some mistakes are inevitable when you begin.", translation: "刚开始时犯一些错误是不可避免的。", collocation: "an inevitable consequence", root: "in- 不 + evit 避免 + -able", family: "inevitability · inevitably", level: "CET-6" },
  { word: "perceive", phonetic: "/pəˈsiːv/", part: "v.", meaning: "察觉；理解；认为", sentence: "People perceive risk in different ways.", translation: "人们以不同方式感知风险。", collocation: "perceive A as B", root: "per- 完全 + ceive 拿取", family: "perception · perceptive", level: "CET-4" },
  { word: "versatile", phonetic: "/ˈvɜːsətaɪl/", part: "adj.", meaning: "多才多艺的；用途广泛的", sentence: "This is a versatile tool for language learners.", translation: "这是一个适合语言学习者的多用途工具。", collocation: "a versatile performer", root: "vers 转 + -atile 能够…的", family: "versatility · versatilely", level: "IELTS" },
  { word: "contemplate", phonetic: "/ˈkɒntəmpleɪt/", part: "v.", meaning: "沉思；考虑", sentence: "She paused to contemplate her next move.", translation: "她停下来思考下一步行动。", collocation: "contemplate doing", root: "con- 共同 + templ 观察", family: "contemplation · contemplative", level: "IELTS" },
  { word: "arbitrary", phonetic: "/ˈɑːbɪtrəri/", part: "adj.", meaning: "任意的；武断的", sentence: "The deadline should not feel arbitrary.", translation: "截止日期不应该显得毫无依据。", collocation: "an arbitrary decision", root: "arbiter 仲裁者", family: "arbitrariness · arbitrarily", level: "GRE" },
  { word: "profound", phonetic: "/prəˈfaʊnd/", part: "adj.", meaning: "深刻的；深远的", sentence: "Reading had a profound effect on his life.", translation: "阅读对他的人生产生了深远影响。", collocation: "a profound impact", root: "pro- 向前 + fund 底部", family: "profoundly · profundity", level: "CET-6" },
  { word: "feasible", phonetic: "/ˈfiːzəbl/", part: "adj.", meaning: "可行的；可能的", sentence: "The plan is ambitious but feasible.", translation: "这个计划很有雄心，但切实可行。", collocation: "a feasible solution", root: "feas 做 + -ible 能够", family: "feasibility · feasibly", level: "CET-6" },
  { word: "conventional", phonetic: "/kənˈvenʃənl/", part: "adj.", meaning: "传统的；常规的", sentence: "They rejected the conventional approach.", translation: "他们放弃了传统方法。", collocation: "conventional wisdom", root: "con- 共同 + vent 来", family: "convention · conventionally", level: "CET-4" },
  { word: "meticulous", phonetic: "/məˈtɪkjələs/", part: "adj.", meaning: "一丝不苟的；细致的", sentence: "He keeps meticulous records of every experiment.", translation: "他一丝不苟地记录每次实验。", collocation: "meticulous attention", root: "metus 恐惧 → 害怕出错", family: "meticulously · meticulousness", level: "GRE" },
  { word: "transient", phonetic: "/ˈtrænziənt/", part: "adj.", meaning: "短暂的；临时的", sentence: "The feeling of discomfort is transient.", translation: "这种不适感是短暂的。", collocation: "a transient phase", root: "trans- 穿过 + ire 走", family: "transience · transiently", level: "GRE" },
  { word: "convey", phonetic: "/kənˈveɪ/", part: "v.", meaning: "传达；运送", sentence: "A good example can convey meaning quickly.", translation: "一个好例子能快速传达含义。", collocation: "convey a message", root: "con- 共同 + via 道路", family: "conveyance · conveyor", level: "CET-4" },
  { word: "scrutinize", phonetic: "/ˈskruːtənaɪz/", part: "v.", meaning: "仔细检查；审视", sentence: "Researchers scrutinized the results.", translation: "研究人员仔细审查了结果。", collocation: "scrutinize the evidence", root: "scrut 搜查 + -ize", family: "scrutiny · scrutinizer", level: "GRE" },
  { word: "prevalent", phonetic: "/ˈprevələnt/", part: "adj.", meaning: "普遍的；盛行的", sentence: "This belief is still prevalent among students.", translation: "这种观念在学生中仍然很普遍。", collocation: "widely prevalent", root: "pre- 在前 + val 强", family: "prevalence · prevail", level: "IELTS" },
  { word: "mitigate", phonetic: "/ˈmɪtɪɡeɪt/", part: "v.", meaning: "减轻；缓和", sentence: "Regular review helps mitigate forgetting.", translation: "定期复习有助于减缓遗忘。", collocation: "mitigate the risk", root: "mitis 柔和 + -gate", family: "mitigation · mitigating", level: "GRE" },
  { word: "infer", phonetic: "/ɪnˈfɜː/", part: "v.", meaning: "推断；推论", sentence: "We can infer the meaning from the context.", translation: "我们可以从语境中推断词义。", collocation: "infer from evidence", root: "in- 进入 + fer 带来", family: "inference · inferential", level: "CET-6" },
  { word: "novel", phonetic: "/ˈnɒvl/", part: "adj.", meaning: "新颖的；新奇的", sentence: "The team proposed a novel solution.", translation: "团队提出了一个新颖的解决方案。", collocation: "a novel approach", root: "nov 新 + -el", family: "novelty · innovate", level: "CET-6" },
  { word: "rigorous", phonetic: "/ˈrɪɡərəs/", part: "adj.", meaning: "严谨的；严格的", sentence: "The method requires rigorous testing.", translation: "这种方法需要严格测试。", collocation: "rigorous analysis", root: "rigor 僵硬、严格", family: "rigor · rigorously", level: "IELTS" },
  { word: "facilitate", phonetic: "/fəˈsɪlɪteɪt/", part: "v.", meaning: "促进；使便利", sentence: "Images can facilitate vocabulary recall.", translation: "图像可以促进词汇回忆。", collocation: "facilitate learning", root: "facil 容易 + -itate", family: "facilitation · facilitator", level: "CET-6" },
  { word: "plausible", phonetic: "/ˈplɔːzəbl/", part: "adj.", meaning: "看似合理的；可信的", sentence: "Her explanation sounds plausible.", translation: "她的解释听起来合情合理。", collocation: "a plausible explanation", root: "plaus 鼓掌 + -ible", family: "plausibility · plausibly", level: "IELTS" },
  { word: "cumulative", phonetic: "/ˈkjuːmjələtɪv/", part: "adj.", meaning: "累积的；渐增的", sentence: "Learning has a cumulative effect.", translation: "学习具有累积效应。", collocation: "cumulative progress", root: "cumul 堆积 + -ative", family: "accumulate · accumulation", level: "IELTS" },
  { word: "elaborate", phonetic: "/ɪˈlæbərət/", part: "adj.", meaning: "精心制作的；详尽的", sentence: "The system does not need an elaborate setup.", translation: "这个系统不需要复杂的设置。", collocation: "an elaborate design", root: "e- 向外 + labor 劳动", family: "elaboration · elaborately", level: "CET-6" },
  { word: "disrupt", phonetic: "/dɪsˈrʌpt/", part: "v.", meaning: "扰乱；使中断", sentence: "Notifications can disrupt deep focus.", translation: "通知会打断深度专注。", collocation: "disrupt the process", root: "dis- 分开 + rupt 破裂", family: "disruption · disruptive", level: "CET-6" },
  { word: "empirical", phonetic: "/ɪmˈpɪrɪkl/", part: "adj.", meaning: "以观察或实验为依据的", sentence: "The claim is supported by empirical evidence.", translation: "这一主张得到了实证证据支持。", collocation: "empirical research", root: "empeiria 经验", family: "empiricism · empirically", level: "IELTS" },
  { word: "distinct", phonetic: "/dɪˈstɪŋkt/", part: "adj.", meaning: "明显不同的；清晰的", sentence: "The two words have distinct meanings.", translation: "这两个词有明显不同的含义。", collocation: "a distinct advantage", root: "di- 分开 + sting 刺、标记", family: "distinction · distinctive", level: "CET-4" },
  { word: "reluctant", phonetic: "/rɪˈlʌktənt/", part: "adj.", meaning: "不情愿的；勉强的", sentence: "He was reluctant to guess the answer.", translation: "他不太愿意猜答案。", collocation: "reluctant to do", root: "re- 向后 + luct 斗争", family: "reluctance · reluctantly", level: "CET-4" },
  { word: "attain", phonetic: "/əˈteɪn/", part: "v.", meaning: "达到；获得", sentence: "Small steps help you attain fluency.", translation: "小步前进能帮助你达到流利程度。", collocation: "attain a goal", root: "at- 向 + tain 持有", family: "attainment · attainable", level: "CET-6" },
  { word: "immerse", phonetic: "/ɪˈmɜːs/", part: "v.", meaning: "使沉浸；浸入", sentence: "Immerse yourself in meaningful English.", translation: "让自己沉浸在有意义的英语中。", collocation: "immerse oneself in", root: "im- 进入 + mers 沉入", family: "immersion · immersive", level: "CET-6" },
  { word: "retain", phonetic: "/rɪˈteɪn/", part: "v.", meaning: "保留；记住", sentence: "We retain words better when they have context.", translation: "有语境时，我们能更好地记住单词。", collocation: "retain information", root: "re- 回 + tain 持有", family: "retention · retentive", level: "CET-4" },
  { word: "spontaneous", phonetic: "/spɒnˈteɪniəs/", part: "adj.", meaning: "自发的；自然的", sentence: "The conversation felt relaxed and spontaneous.", translation: "这场对话让人感觉轻松自然。", collocation: "a spontaneous response", root: "sponte 自愿地", family: "spontaneity · spontaneously", level: "IELTS" },
  { word: "counterpart", phonetic: "/ˈkaʊntəpɑːt/", part: "n.", meaning: "对应的人或事物", sentence: "The digital version is faster than its paper counterpart.", translation: "数字版本比对应的纸质版本更快。", collocation: "foreign counterpart", root: "counter 对应 + part 部分", family: "counterparts", level: "CET-6" },
  { word: "integrate", phonetic: "/ˈɪntɪɡreɪt/", part: "v.", meaning: "整合；融入", sentence: "Try to integrate new words into daily speech.", translation: "试着把新单词融入日常表达。", collocation: "integrate A into B", root: "integer 完整 + -ate", family: "integration · integrated", level: "CET-4" },
  { word: "reinforce", phonetic: "/ˌriːɪnˈfɔːs/", part: "v.", meaning: "加强；巩固", sentence: "A short quiz reinforces the memory.", translation: "一个小测验可以巩固记忆。", collocation: "reinforce learning", root: "re- 再 + in- 进入 + force 力量", family: "reinforcement · reinforced", level: "CET-6" },
  { word: "contextual", phonetic: "/kənˈtekstʃuəl/", part: "adj.", meaning: "与语境相关的", sentence: "Contextual clues reveal how a word is used.", translation: "语境线索能揭示单词的用法。", collocation: "contextual information", root: "con- 共同 + text 编织", family: "context · contextualize", level: "IELTS" },
  { word: "assess", phonetic: "/əˈses/", part: "v.", meaning: "评估；评价", sentence: "The app assesses how well you remember each word.", translation: "应用会评估你对每个单词的掌握程度。", collocation: "assess the impact", root: "as- 在旁 + sess 坐", family: "assessment · assessor", level: "CET-4" },
  { word: "adaptive", phonetic: "/əˈdæptɪv/", part: "adj.", meaning: "适应性的；自适应的", sentence: "An adaptive plan changes with your performance.", translation: "自适应计划会随你的表现而变化。", collocation: "adaptive learning", root: "ad- 向 + apt 合适", family: "adapt · adaptation", level: "IELTS" },
  { word: "retrieve", phonetic: "/rɪˈtriːv/", part: "v.", meaning: "取回；检索；回忆起", sentence: "Active recall trains the brain to retrieve information.", translation: "主动回忆训练大脑提取信息。", collocation: "retrieve information", root: "re- 回 + trouv 找到", family: "retrieval · retrievable", level: "CET-6" },
  { word: "consolidate", phonetic: "/kənˈsɒlɪdeɪt/", part: "v.", meaning: "巩固；合并", sentence: "Sleep helps consolidate new memories.", translation: "睡眠有助于巩固新记忆。", collocation: "consolidate knowledge", root: "con- 共同 + solid 坚固", family: "consolidation · consolidated", level: "IELTS" },
  { word: "intuitive", phonetic: "/ɪnˈtjuːɪtɪv/", part: "adj.", meaning: "直观的；凭直觉的", sentence: "The controls should feel simple and intuitive.", translation: "这些操作应该简单而直观。", collocation: "an intuitive interface", root: "in- 进入 + tu 看", family: "intuition · intuitively", level: "CET-6" },
  { word: "articulate", phonetic: "/ɑːˈtɪkjuleɪt/", part: "v.", meaning: "清楚表达", sentence: "She can articulate complex ideas clearly.", translation: "她能清晰表达复杂的想法。", collocation: "articulate a view", root: "articul 关节 → 连接清楚", family: "articulation · articulate", level: "IELTS" },
  { word: "nuance", phonetic: "/ˈnjuːɑːns/", part: "n.", meaning: "细微差别；微妙之处", sentence: "Examples help learners notice shades of nuance.", translation: "例句帮助学习者注意细微的语义差别。", collocation: "a subtle nuance", root: "nue 云 → 阴影层次", family: "nuanced · nuances", level: "GRE" },
];

const BOOKS = [
  { name: "核心进阶词汇", detail: "CET-4 · CET-6", total: 50, progress: 24, color: "mint" },
  { name: "雅思高频语境", detail: "IELTS Academic", total: 36, progress: 8, color: "blue" },
  { name: "我的生词本", detail: "阅读中收集", total: 12, progress: 3, color: "peach" },
];

const ratingLabels = ["忘记", "模糊", "认识", "熟练"];
const ratingIntervals = ["10 分钟", "1 天", "4 天", "12 天"];

function buildLocalCoach(word: Word, prompt: string) {
  if (prompt.includes("近义") || prompt.includes("区别")) {
    return `辨析 ${word.word}：它强调“${word.meaning.split("；")[0]}”。放在句子 “${word.sentence}” 中，语气比普通表达更准确。记忆时先抓住核心场景，再比较近义词，不要孤立背中文。`;
  }
  if (prompt.includes("题") || prompt.includes("测")) {
    return `小测验：Small habits can ____ long-term progress.\nA. disrupt  B. sustain  C. diminish\n\n先在脑中补全，再告诉我你的答案。`;
  }
  if (prompt.includes("例句") || prompt.includes("语境")) {
    return `给你一个学习语境：When you review ${word.word} in several meaningful situations, the memory becomes easier to retrieve. 先读懂整句，再回想 ${word.word} 的核心含义。`;
  }
  return `把 ${word.word} 记成一幅动作画面：${word.root}。核心不是死记“${word.meaning}”，而是把它放回这句真实表达：${word.sentence}`;
}

export default function Home() {
  const [started, setStarted] = useState(false);
  const [activeView, setActiveView] = useState<"learn" | "books" | "history" | "settings">("learn");
  const [revealed, setRevealed] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiAnswer, setAiAnswer] = useState("我会用语境、联想和小测验帮你真正记住这个词。");
  const [aiLoading, setAiLoading] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [toast, setToast] = useState("");

  const current = WORDS[wordIndex % WORDS.length];
  const todayDone = Math.min(reviews.length, dailyGoal);
  const progress = Math.round((todayDone / dailyGoal) * 100);
  const recentReviews = useMemo(() => [...reviews].reverse().slice(0, 8), [reviews]);

  useEffect(() => {
    const saved = localStorage.getItem("wordloop-state");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        setReviews(state.reviews ?? []);
        setWordIndex(state.wordIndex ?? 0);
        setStarted(state.started ?? false);
        setDailyGoal(state.dailyGoal ?? 20);
        setSoundOn(state.soundOn ?? true);
      } catch {
        localStorage.removeItem("wordloop-state");
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("wordloop-state", JSON.stringify({ reviews, wordIndex, started, dailyGoal, soundOn }));
  }, [reviews, wordIndex, started, dailyGoal, soundOn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!started) setStarted(true);
        else if (activeView === "learn") setRevealed(true);
      }
      if (event.key.toLowerCase() === "a" && started) setAiOpen((value) => !value);
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) rateWord(Number(event.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function speak() {
    if (!("speechSynthesis" in window)) {
      setToast("当前浏览器不支持语音播放");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(current.word);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
  }

  function rateWord(rating: number) {
    const days = [0, 1, 4, 12][rating];
    const next = new Date();
    next.setDate(next.getDate() + days);
    setReviews((items) => [
      ...items,
      {
        word: current.word,
        rating,
        nextReview: rating === 0 ? "今天稍后" : `${days} 天后`,
        reviewedAt: new Date().toISOString(),
      },
    ]);
    setToast(`${ratingLabels[rating]} · ${ratingIntervals[rating]}后再见`);
    setRevealed(false);
    setWordIndex((index) => (index + 1) % WORDS.length);
    setAiAnswer("我会用语境、联想和小测验帮你真正记住这个词。");
    if (soundOn) setTimeout(speakNext, 80);
    setTimeout(() => setToast(""), 1800);
  }

  function speakNext() {
    if (!("speechSynthesis" in window)) return;
    const nextWord = WORDS[(wordIndex + 1) % WORDS.length];
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(nextWord.word);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
  }

  async function askCoach(prompt: string) {
    const question = prompt.trim();
    if (!question || aiLoading) return;
    setAiLoading(true);
    setAiInput("");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: current, prompt: question }),
      });
      if (!response.ok) throw new Error("request failed");
      const data = await response.json();
      setAiAnswer(data.answer);
    } catch {
      setAiAnswer(buildLocalCoach(current, question));
    } finally {
      setAiLoading(false);
    }
  }

  function submitCoach(event: FormEvent) {
    event.preventDefault();
    askCoach(aiInput);
  }

  const navigation = [
    { id: "learn", label: "学习", mark: "⌁" },
    { id: "books", label: "词书", mark: "□" },
    { id: "history", label: "轨迹", mark: "↗" },
    { id: "settings", label: "设置", mark: "○" },
  ] as const;

  return (
    <main className="app-shell">
      {!started && (
        <button className="welcome" onClick={() => setStarted(true)} aria-label="开始学习">
          <span className="welcome-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="welcome-name">词环</span>
          <span className="welcome-hint">按空格键或点击开始</span>
        </button>
      )}

      <aside className="side-rail" aria-label="主导航">
        <button className="brand" onClick={() => setActiveView("learn")} aria-label="词环首页">
          <span className="brand-orbit"><i /></span>
          <span>词环</span>
        </button>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={activeView === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActiveView(item.id)}
              aria-current={activeView === item.id ? "page" : undefined}
            >
              <span className="nav-mark">{item.mark}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button className="ai-rail-button" onClick={() => setAiOpen(true)}>
          <span>AI</span>
          <small>记忆教练</small>
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">今日记忆轨道</p>
            <p className="topbar-title">{activeView === "learn" ? "核心进阶词汇" : navigation.find((item) => item.id === activeView)?.label}</p>
          </div>
          <div className="daily-progress" aria-label={`今日完成 ${todayDone} 个，共 ${dailyGoal} 个`}>
            <span>{todayDone}</span>
            <i />
            <span>{dailyGoal}</span>
          </div>
        </header>

        {activeView === "learn" && (
          <div className="learn-view">
            <div className="orbit-stage" style={{ "--progress": `${Math.max(progress, 4)}%` } as React.CSSProperties}>
              <div className="orbit-label orbit-label-top">NEW · {current.level}</div>
              <article className={revealed ? "word-card revealed" : "word-card"}>
                <div className="word-heading">
                  <p className="word-count">{String((wordIndex % dailyGoal) + 1).padStart(2, "0")} / {dailyGoal}</p>
                  <button className="sound-button" onClick={speak} aria-label={`播放 ${current.word} 的发音`}>◖))</button>
                </div>
                <button className="word-face" onClick={() => setRevealed(true)} aria-label="显示单词释义">
                  <h1>{current.word}</h1>
                  <p>{current.phonetic}</p>
                  {!revealed && <span>先在脑中回忆，再点击查看</span>}
                </button>

                {revealed && (
                  <div className="meaning-panel">
                    <div className="meaning-main">
                      <span>{current.part}</span>
                      <strong>{current.meaning}</strong>
                    </div>
                    <div className="context-block">
                      <p className="context-sentence">{current.sentence}</p>
                      <p className="context-translation">{current.translation}</p>
                    </div>
                    <div className="word-details">
                      <div><span>常用搭配</span><strong>{current.collocation}</strong></div>
                      <div><span>词源联想</span><strong>{current.root}</strong></div>
                      <div><span>词族网络</span><strong>{current.family}</strong></div>
                    </div>
                  </div>
                )}
              </article>
              <div className="orbit-label orbit-label-bottom">{revealed ? "根据真实记忆感受评分" : "SPACE · 查看释义"}</div>
            </div>

            <div className={revealed ? "rating-bar visible" : "rating-bar"}>
              {ratingLabels.map((label, index) => (
                <button key={label} onClick={() => rateWord(index)}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                  <small>{ratingIntervals[index]}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeView === "books" && (
          <div className="content-view">
            <div className="section-heading">
              <div><p className="eyebrow">选择学习内容</p><h1>让词汇进入真实语境</h1></div>
              <button className="primary-button">＋ 导入单词</button>
            </div>
            <div className="book-grid">
              {BOOKS.map((book) => (
                <button className="book-card" key={book.name} onClick={() => setActiveView("learn")}>
                  <span className={`book-swatch ${book.color}`}>{book.name.slice(0, 1)}</span>
                  <div>
                    <small>{book.detail}</small>
                    <h2>{book.name}</h2>
                    <p>{book.progress} 个已形成记忆 · 共 {book.total} 词</p>
                  </div>
                  <div className="book-line"><i style={{ width: `${(book.progress / book.total) * 100}%` }} /></div>
                </button>
              ))}
              <button className="book-card empty-book">
                <span>＋</span>
                <p>创建新的语境词书</p>
              </button>
            </div>
          </div>
        )}

        {activeView === "history" && (
          <div className="content-view">
            <div className="section-heading">
              <div><p className="eyebrow">MEMORY TRACE</p><h1>每一次回忆都算数</h1></div>
              <div className="streak"><strong>{reviews.length ? Math.min(7, Math.ceil(reviews.length / 3)) : 0}</strong><span>连续学习天</span></div>
            </div>
            <div className="stat-grid">
              <div><span>今日完成</span><strong>{todayDone}</strong><small>目标 {dailyGoal}</small></div>
              <div><span>记忆强度</span><strong>{reviews.length ? Math.round((reviews.filter((item) => item.rating > 1).length / reviews.length) * 100) : 0}%</strong><small>根据主动回忆计算</small></div>
              <div><span>待复习</span><strong>{Math.max(0, 8 - reviews.length)}</strong><small>算法动态安排</small></div>
            </div>
            <div className="history-panel">
              <div className="panel-title"><h2>最近学习</h2><span>{reviews.length} 次记忆记录</span></div>
              {recentReviews.length ? recentReviews.map((review) => (
                <div className="history-row" key={`${review.word}-${review.reviewedAt}`}>
                  <strong>{review.word}</strong>
                  <span className={`rating-dot rating-${review.rating}`}>{ratingLabels[review.rating]}</span>
                  <span>{review.nextReview}</span>
                </div>
              )) : <div className="empty-state">完成第一个单词后，记忆轨迹会出现在这里。</div>}
            </div>
          </div>
        )}

        {activeView === "settings" && (
          <div className="content-view settings-view">
            <div className="section-heading"><div><p className="eyebrow">偏好设置</p><h1>把节奏调成你的样子</h1></div></div>
            <div className="settings-panel">
              <label>
                <span><strong>每日新词</strong><small>保持一个能够长期坚持的数量</small></span>
                <select value={dailyGoal} onChange={(event) => setDailyGoal(Number(event.target.value))}>
                  <option value={10}>10 词</option>
                  <option value={20}>20 词</option>
                  <option value={30}>30 词</option>
                  <option value={50}>50 词</option>
                </select>
              </label>
              <label>
                <span><strong>自动播放发音</strong><small>切换到下一个单词时播放美音</small></span>
                <input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />
              </label>
              <label>
                <span><strong>AI 记忆教练</strong><small>已启用；未配置云端模型时自动使用本地模式</small></span>
                <span className="status-pill">可用</span>
              </label>
              <button className="reset-button" onClick={() => { setReviews([]); setWordIndex(0); setToast("学习记录已清空"); }}>
                清空本机学习记录
              </button>
            </div>
            <div className="shortcut-panel">
              <h2>快捷键</h2>
              <div><span><kbd>Space</kbd> 查看释义</span><span><kbd>1–4</kbd> 评估记忆</span><span><kbd>A</kbd> AI 教练</span></div>
            </div>
          </div>
        )}
      </section>

      <aside className={aiOpen ? "coach-panel open" : "coach-panel"} aria-label="AI 记忆教练">
        <div className="coach-head">
          <div><span className="coach-badge">AI</span><div><strong>记忆教练</strong><small>围绕 {current.word}</small></div></div>
          <button onClick={() => setAiOpen(false)} aria-label="关闭 AI 教练">×</button>
        </div>
        <div className="coach-context">
          <span>正在学习</span>
          <strong>{current.word}</strong>
          <small>{current.meaning}</small>
        </div>
        <div className="coach-answer">
          <span>词环 AI</span>
          <p>{aiLoading ? "正在组织一个更容易记住的解释…" : aiAnswer}</p>
        </div>
        <div className="coach-prompts">
          {["给我一个记忆联想", "换个真实语境", "解释近义词区别", "出一道小测验"].map((prompt) => (
            <button key={prompt} onClick={() => askCoach(prompt)}>{prompt}</button>
          ))}
        </div>
        <form onSubmit={submitCoach}>
          <input value={aiInput} onChange={(event) => setAiInput(event.target.value)} placeholder="问问这个词该怎么记…" aria-label="向 AI 教练提问" />
          <button type="submit" aria-label="发送问题">↗</button>
        </form>
        <p className="coach-note">AI 会结合当前单词和语境回答</p>
      </aside>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
