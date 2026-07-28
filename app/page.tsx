"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  isPrimaryLearningWord,
  REDBOOK_SOURCE_TOTAL,
} from "../lib/redbook";
import {
  buildActivityCalendar,
  buildStudyKey,
  dateKey,
  formatDueTime,
  learningStats,
  MAX_REVIEWS,
  parseStoredState,
  reviewDueAt,
  splitMeaning,
  STORAGE_KEY,
  STORAGE_VERSION,
  type MistakeRecord,
  type Review,
  type SavedWord,
  type StudyMode,
  type StudyPositions,
  type StudyScope,
  type Word,
} from "../lib/study";

type RedbookStatus = "loading" | "ready" | "error";
type ActivityRange = 140 | 182 | 365;

type RedbookData = {
  metadata: {
    title: string;
    total: number;
    sectionCounts: Record<string, number>;
    learningItemCount?: number;
  };
  words: Word[];
};

type RedbookAnalysisData = {
  metadata: {
    auditedEntries: number;
    learningItemCount: number;
  };
  entries: Record<string, {
    correctedWord?: string;
    relation?: Word["relation"];
  }>;
};

const SECTION_META = [
  { name: "必考词", detail: "26 个单元", total: 1856, color: "mint", marker: "必" },
  { name: "基础词", detail: "31 个单元", total: 3680, color: "blue", marker: "基" },
  { name: "超纲词", detail: "按首字母编排", total: 1014, color: "peach", marker: "超" },
];

const ratingLabels = ["忘记", "模糊", "认识", "熟练"];
const ratingIntervals = ["10 分钟", "1 天", "4 天", "12 天"];
const activityRangeLabels: Record<ActivityRange, string> = {
  140: "20 周",
  182: "半年",
  365: "一年",
};
const REDBOOK_PLACEHOLDER: Word = {
  word: "红宝书",
  meaning: "正在载入本地词库",
  section: "2027 考研英语",
};

function wordKey(word: Word) {
  return word.id !== undefined
    ? `redbook-${word.id}`
    : `${word.section ?? "redbook"}-${word.unit ?? "all"}-${word.word}`;
}

function seededScore(value: string, seed: number) {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function shuffleWithSeed(words: Word[], seed: number) {
  return [...words].sort(
    (first, second) =>
      seededScore(wordKey(first), seed) - seededScore(wordKey(second), seed),
  );
}

function buildLocalCoach(word: Word, prompt: string) {
  const relationHint = word.relation
    ? `词族提示：${word.relation.label}。${word.relation.note}`
    : "";
  if (prompt.includes("近义") || prompt.includes("区别")) {
    return `${relationHint}辨析 ${word.word}：它强调“${word.meaning.split("；")[0]}”。记忆时先抓住核心场景，再比较近义词，不要孤立背中文。`;
  }
  if (prompt.includes("题") || prompt.includes("测")) {
    return `${relationHint}主动回忆：先遮住释义，用 ${word.word} 造一个与你今天经历有关的英文句子。再回答：它在红宝书中的核心含义“${word.meaning.split("；")[0]}”是什么？`;
  }
  if (prompt.includes("例句") || prompt.includes("语境")) {
    return `${relationHint}给你一个学习语境：When you review ${word.word} in several meaningful situations, the memory becomes easier to retrieve. 先读懂整句，再回想 ${word.word} 的核心含义。`;
  }
  return `${relationHint}把 ${word.word} 记成一幅动作画面：${word.root ?? "先抓住词形和核心词义"}。核心不是死记“${word.meaning}”，而是主动造一个与你有关的句子。`;
}

export default function Home() {
  const [started, setStarted] = useState(false);
  const [activeView, setActiveView] = useState<"learn" | "books" | "wordbook" | "history" | "settings">("learn");
  const [revealed, setRevealed] = useState(false);
  const [positions, setPositions] = useState<StudyPositions>({});
  const [reviews, setReviews] = useState<Review[]>([]);
  const [favorites, setFavorites] = useState<SavedWord[]>([]);
  const [mistakes, setMistakes] = useState<MistakeRecord[]>([]);
  const [studyMode, setStudyMode] = useState<StudyMode>("ordered");
  const [studyScope, setStudyScope] = useState<StudyScope>("selection");
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [wordbookTab, setWordbookTab] = useState<"favorites" | "mistakes">("favorites");
  const [pendingWordId, setPendingWordId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiAnswer, setAiAnswer] = useState("我会用语境、联想和小测验帮你真正记住这个词。");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<"unknown" | "cloud" | "local">("unknown");
  const [soundOn, setSoundOn] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [clock, setClock] = useState(() => Date.now());
  const [toast, setToast] = useState("");
  const [redbookWords, setRedbookWords] = useState<Word[]>([]);
  const [redbookStatus, setRedbookStatus] = useState<RedbookStatus>("loading");
  const [selectedSection, setSelectedSection] = useState("必考词");
  const [selectedUnit, setSelectedUnit] = useState<number | string | "all">(1);
  const [activityRange, setActivityRange] = useState<ActivityRange>(365);
  const [activityOffset, setActivityOffset] = useState(0);
  const [selectedActivityDate, setSelectedActivityDate] = useState("");
  const [learningItemCount, setLearningItemCount] = useState(REDBOOK_SOURCE_TOTAL);

  const filteredStudyWords = useMemo(() => {
    if (redbookStatus !== "ready") return [];
    const learningWords = redbookWords.filter((word) => isPrimaryLearningWord(word.id));
    if (studyScope === "all") return learningWords;
    const sectionWords = learningWords.filter((word) => word.section === selectedSection);
    if (selectedUnit === "all") return sectionWords;
    return sectionWords.filter((word) => String(word.unit) === String(selectedUnit));
  }, [redbookStatus, redbookWords, selectedSection, selectedUnit, studyScope]);
  const studyWords = useMemo(
    () => studyMode === "shuffled" ? shuffleWithSeed(filteredStudyWords, shuffleSeed) : filteredStudyWords,
    [filteredStudyWords, shuffleSeed, studyMode],
  );
  const studyKey = buildStudyKey(
    studyScope,
    studyMode,
    selectedSection,
    selectedUnit,
    shuffleSeed,
  );
  const wordIndex = positions[studyKey] ?? 0;
  const current = studyWords[wordIndex % Math.max(1, studyWords.length)] ?? REDBOOK_PLACEHOLDER;
  const redbookReady = redbookStatus === "ready";
  const isFavorite = current.id !== undefined
    && favorites.some((item) => item.wordId === current.id);
  const stats = useMemo(
    () => learningStats(reviews, new Date(clock)),
    [clock, reviews],
  );
  const activityEndTime = useMemo(() => {
    const end = new Date(clock);
    end.setDate(end.getDate() - activityOffset);
    return end.getTime();
  }, [activityOffset, clock]);
  const activityDays = useMemo(
    () => buildActivityCalendar(reviews, activityRange, new Date(activityEndTime)),
    [activityEndTime, activityRange, reviews],
  );
  const activityDateRange = activityDays.length
    ? `${activityDays[0].date.replaceAll("-", ".")} — ${activityDays.at(-1)?.date.replaceAll("-", ".")}`
    : "";
  const selectedDayReviews = useMemo(() => {
    if (!selectedActivityDate) return [];
    const latestByWord = new Map<string, Review>();
    for (const review of reviews) {
      if (dateKey(review.reviewedAt) !== selectedActivityDate) continue;
      const key = review.wordId !== undefined
        ? `id:${review.wordId}`
        : `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`;
      const previous = latestByWord.get(key);
      if (!previous || previous.reviewedAt < review.reviewedAt) {
        latestByWord.set(key, review);
      }
    }
    return [...latestByWord.values()].sort((first, second) =>
      second.reviewedAt.localeCompare(first.reviewedAt));
  }, [reviews, selectedActivityDate]);
  const selectedWeakCount = selectedDayReviews.filter((review) => review.rating <= 1).length;
  const todayDone = Math.min(stats.todayDone, dailyGoal);
  const progress = Math.round((todayDone / dailyGoal) * 100);
  const recentReviews = useMemo(() => [...reviews].reverse().slice(0, 8), [reviews]);
  const availableUnits = useMemo(() => {
    const values = redbookWords
      .filter((word) => word.section === selectedSection)
      .map((word) => word.unit)
      .filter((value): value is number | string => value !== undefined);
    return [...new Set(values.map(String))].sort((a, b) => {
      const aNumber = Number(a);
      const bNumber = Number(b);
      if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) return aNumber - bNumber;
      return a.localeCompare(b);
    });
  }, [redbookWords, selectedSection]);
  const currentMeaning = splitMeaning(current.meaning);
  const currentPart = current.part ?? currentMeaning.part;
  const wordById = useMemo(
    () => new Map(redbookWords.map((word) => [word.id, word])),
    [redbookWords],
  );
  const favoriteWords = useMemo(
    () => favorites
      .map((item) => ({ ...item, word: wordById.get(item.wordId) }))
      .filter((item): item is SavedWord & { word: Word } => item.word !== undefined),
    [favorites, wordById],
  );
  const mistakeWords = useMemo(
    () => mistakes
      .map((item) => ({ ...item, word: wordById.get(item.wordId) }))
      .filter((item): item is MistakeRecord & { word: Word } => item.word !== undefined),
    [mistakes, wordById],
  );
  const currentLocation = redbookStatus === "loading"
    ? "2027 红宝书 · 正在载入"
    : redbookStatus === "error"
      ? "2027 红宝书 · 读取失败"
      : studyScope === "all"
        ? `全书乱序 · ${current.section ?? "红宝书"} ${current.unit ? `Unit ${current.unit}` : ""}`
        : `${current.section ?? selectedSection} · ${current.unit ? `Unit ${current.unit}` : "全书"}`;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const state = parseStoredState(saved);
          setReviews(state.reviews);
          setPositions(state.positions);
          setStarted(state.started);
          setDailyGoal(state.dailyGoal);
          setSoundOn(state.soundOn);
          setFavorites(state.favorites);
          setMistakes(state.mistakes);
          setStudyMode(state.studyMode);
          setStudyScope(state.studyScope);
          setShuffleSeed(state.shuffleSeed);
          setSelectedSection(state.selectedSection);
          setSelectedUnit(state.selectedUnit);
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setHydrated(true);
    });
    Promise.all([
      fetch("/data/redbook.json").then((response) => {
        if (!response.ok) throw new Error("redbook data missing");
        return response.json() as Promise<RedbookData>;
      }),
      fetch("/data/redbook-analysis.json").then((response) => {
        if (!response.ok) throw new Error("redbook analysis missing");
        return response.json() as Promise<RedbookAnalysisData>;
      }),
    ])
      .then(([data, analysis]) => {
        if (!data.words.length) throw new Error("redbook data empty");
        if (analysis.metadata.auditedEntries !== REDBOOK_SOURCE_TOTAL) {
          throw new Error("redbook analysis incomplete");
        }
        const auditedWords = data.words.map((word) => {
          const audit = word.id === undefined ? undefined : analysis.entries[String(word.id)];
          return {
            ...word,
            word: audit?.correctedWord ?? word.word,
            relation: audit?.relation,
          };
        });
        const idLookup = new Map(
          auditedWords.map((word) => [
            `${word.section ?? ""}:${word.unit ?? ""}:${word.word.toLowerCase()}`,
            word.id,
          ]),
        );
        setRedbookWords(auditedWords);
        setLearningItemCount(analysis.metadata.learningItemCount);
        setReviews((items) => items.map((review) => review.wordId
          ? review
          : {
              ...review,
              wordId: idLookup.get(
                `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`,
              ),
            }));
        setRedbookStatus("ready");
      })
      .catch(() => {
        setRedbookStatus("error");
        setToast("红宝书词库读取失败，请检查本地资源");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: STORAGE_VERSION,
      reviews,
      positions,
      started,
      dailyGoal,
      soundOn,
      favorites,
      mistakes,
      studyMode,
      studyScope,
      shuffleSeed,
      selectedSection,
      selectedUnit,
    }));
  }, [dailyGoal, favorites, hydrated, mistakes, positions, reviews, selectedSection, selectedUnit, shuffleSeed, soundOn, started, studyMode, studyScope]);

  useEffect(() => {
    if (!pendingWordId || !studyWords.length) return;
    const nextIndex = studyWords.findIndex((word) => word.id === pendingWordId);
    queueMicrotask(() => {
      if (nextIndex >= 0) {
        setPositions((items) => ({ ...items, [studyKey]: nextIndex }));
      }
      setPendingWordId(null);
    });
  }, [pendingWordId, studyKey, studyWords]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!redbookReady || selectedUnit === "all" || availableUnits.includes(String(selectedUnit))) return;
    queueMicrotask(() => setSelectedUnit(selectedSection === "超纲词" ? "A" : 1));
  }, [availableUnits, redbookReady, selectedSection, selectedUnit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!started) setStarted(true);
        else if (activeView === "learn" && redbookReady) setRevealed(true);
      }
      if (event.key.toLowerCase() === "a" && started) setAiOpen((value) => !value);
      if (event.key.toLowerCase() === "f" && started && activeView === "learn") toggleFavorite();
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) rateWord(Number(event.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function speak() {
    if (!redbookReady) return;
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
    if (!redbookReady || current.id === undefined) return;
    const now = new Date().toISOString();
    if (rating <= 1) {
      setMistakes((items) => {
        const previous = items.find((item) => item.wordId === current.id);
        const record: MistakeRecord = {
          wordId: current.id!,
          addedAt: previous?.addedAt ?? now,
          mistakeCount: (previous?.mistakeCount ?? 0) + 1,
          lastRating: rating,
          lastMistakeAt: now,
        };
        return [record, ...items.filter((item) => item.wordId !== current.id)];
      });
    }
    setReviews((items) => {
      const nextReviews: Review[] = [...items, {
        wordId: current.id,
        word: current.word,
        rating,
        dueAt: reviewDueAt(now, rating),
        reviewedAt: now,
        section: current.section,
        unit: current.unit,
      }];
      return nextReviews.slice(-MAX_REVIEWS);
    });
    setToast(`${ratingLabels[rating]} · ${ratingIntervals[rating]}后再见`);
    setRevealed(false);
    setPositions((items) => ({
      ...items,
      [studyKey]: (wordIndex + 1) % Math.max(1, studyWords.length),
    }));
    setClock(Date.now());
    setAiAnswer("我会用语境、联想和小测验帮你真正记住这个词。");
    setAiMode("unknown");
    if (soundOn) setTimeout(speakNext, 80);
    setTimeout(() => setToast(""), 1800);
  }

  function changeStudyMode(mode: StudyMode) {
    setStudyScope("selection");
    setStudyMode(mode);
    if (mode === "shuffled") {
      const prefix = `selection:${selectedSection}:${selectedUnit}:shuffled:`;
      setPositions((items) => Object.fromEntries(
        Object.entries(items).filter(([key]) => !key.startsWith(prefix)),
      ));
      setShuffleSeed(Date.now());
    }
    setRevealed(false);
    setToast(mode === "shuffled" ? "已打乱当前单元" : "已恢复红宝书顺序");
    setTimeout(() => setToast(""), 1600);
  }

  function startAllBookShuffle(openLearning = true) {
    setPositions((items) => Object.fromEntries(
      Object.entries(items).filter(([key]) => !key.startsWith("all:shuffled:")),
    ));
    setStudyScope("all");
    setStudyMode("shuffled");
    setShuffleSeed(Date.now());
    setRevealed(false);
    if (openLearning) setActiveView("learn");
    setToast(`已打乱 ${learningItemCount} 个学习项，保留 ${REDBOOK_SOURCE_TOTAL} 条原书来源`);
    setTimeout(() => setToast(""), 1800);
  }

  function toggleFavorite(word: Word = current) {
    if ((!redbookReady && word === current) || word.id === undefined) return;
    const exists = favorites.some((item) => item.wordId === word.id);
    setFavorites((items) => exists
      ? items.filter((item) => item.wordId !== word.id)
      : [{ wordId: word.id!, addedAt: new Date().toISOString() }, ...items]);
    setToast(exists ? "已移出我的词本" : "已加入我的词本");
    setTimeout(() => setToast(""), 1600);
  }

  function focusSavedWord(word: Word) {
    const section = word.section ?? selectedSection;
    const unit = word.unit ?? "all";
    setSelectedSection(section);
    setSelectedUnit(unit);
    setStudyScope("selection");
    setPendingWordId(word.id ?? null);
    setRevealed(false);
    setActiveView("learn");
  }

  function speakNext() {
    if (!("speechSynthesis" in window)) return;
    const nextWord = studyWords[(wordIndex + 1) % Math.max(1, studyWords.length)] ?? REDBOOK_PLACEHOLDER;
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
        body: JSON.stringify({ word: current, prompt: question.slice(0, 500) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("request failed");
      const data = await response.json() as { answer: string; mode?: "cloud" | "local" };
      setAiAnswer(data.answer);
      setAiMode(data.mode === "cloud" ? "cloud" : "local");
    } catch {
      setAiAnswer(buildLocalCoach(current, question));
      setAiMode("local");
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
    { id: "wordbook", label: "词本", mark: "◇" },
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
        <header className={activeView === "learn" ? "topbar learn-topbar" : "topbar"}>
          <div>
            <p className="eyebrow">{activeView === "learn" ? "2027 红宝书伴学" : "词环 WordLoop"}</p>
            <p className="topbar-title">
              {activeView === "learn"
                ? studyScope === "all"
                  ? `全书 ${learningItemCount} 学习项 · 乱序`
                  : `${selectedSection} · ${selectedUnit === "all" ? "全部" : `Unit ${selectedUnit}`}`
                : navigation.find((item) => item.id === activeView)?.label}
            </p>
          </div>
          {activeView === "learn" && (
            <div className="study-tools">
              {redbookWords.length > 0 && (
                <div className="study-picker">
                  <select
                    value={selectedSection}
                    aria-label="选择红宝书词汇分组"
                    onChange={(event) => {
                      const section = event.target.value;
                      setSelectedSection(section);
                      setSelectedUnit(section === "超纲词" ? "A" : 1);
                      setStudyScope("selection");
                      setRevealed(false);
                    }}
                  >
                    {SECTION_META.map((section) => <option key={section.name}>{section.name}</option>)}
                  </select>
                  <select
                    value={String(selectedUnit)}
                    aria-label="选择红宝书单元"
                    onChange={(event) => {
                      setSelectedUnit(event.target.value);
                      setStudyScope("selection");
                      setRevealed(false);
                    }}
                  >
                    <option value="all">全部</option>
                    {availableUnits.map((unit) => <option value={unit} key={unit}>Unit {unit}</option>)}
                  </select>
                </div>
              )}
              <div className="order-switch" aria-label="学习顺序">
                <button
                  className={studyScope === "selection" && studyMode === "ordered" ? "active" : ""}
                  onClick={() => changeStudyMode("ordered")}
                  aria-pressed={studyScope === "selection" && studyMode === "ordered"}
                >
                  顺序
                </button>
                <button
                  className={studyScope === "selection" && studyMode === "shuffled" ? "active" : ""}
                  onClick={() => changeStudyMode("shuffled")}
                  aria-pressed={studyScope === "selection" && studyMode === "shuffled"}
                >
                  乱序
                </button>
                <button
                  className={studyScope === "all" ? "active all" : ""}
                  onClick={() => startAllBookShuffle()}
                  aria-pressed={studyScope === "all"}
                  title={`打乱 ${learningItemCount} 个独立学习项`}
                >
                  全书
                </button>
              </div>
            </div>
          )}
          <div className="daily-progress" aria-label={`今日完成 ${todayDone} 个，共 ${dailyGoal} 个`}>
            <span>{todayDone}</span>
            <i />
            <span>{dailyGoal}</span>
          </div>
        </header>

        {activeView === "learn" && (
          <div className="learn-view">
            <div className="orbit-stage" style={{ "--progress": `${Math.max(progress, 4)}%` } as React.CSSProperties}>
              <div className="orbit-label orbit-label-top">NEW · {currentLocation}</div>
              <article
                className={`${revealed ? "word-card revealed" : "word-card"}${redbookReady ? "" : " loading"}`}
                aria-busy={redbookStatus === "loading"}
              >
                <div className="word-heading">
                  <p className="word-count">{redbookReady ? `${String(Math.min(todayDone + 1, dailyGoal)).padStart(2, "0")} / ${dailyGoal}` : "— / —"}</p>
                  <div className="word-actions">
                    <button
                      className={isFavorite ? "favorite-button saved" : "favorite-button"}
                      onClick={() => toggleFavorite()}
                      disabled={!redbookReady}
                      aria-label={isFavorite ? `将 ${current.word} 移出词本` : `将 ${current.word} 加入词本`}
                      aria-pressed={isFavorite}
                      title={isFavorite ? "移出词本" : "加入词本"}
                    >
                      {isFavorite ? "◆" : "◇"}
                    </button>
                    <button className="sound-button" onClick={speak} disabled={!redbookReady} aria-label={`播放 ${current.word} 的发音`}>◖))</button>
                  </div>
                </div>
                <button className="word-face" onClick={() => redbookReady && setRevealed(true)} disabled={!redbookReady} aria-label="显示单词释义">
                  <h1>{current.word}</h1>
                  <p>{redbookReady ? (current.phonetic ?? `NO. ${String(current.id ?? wordIndex + 1).padStart(4, "0")}`) : "LOCAL VOCABULARY"}</p>
                  {!redbookReady
                    ? <span>{redbookStatus === "loading" ? "正在读取 6550 个考研词汇…" : "未能读取本地红宝书词库"}</span>
                    : !revealed && <span>先在脑中回忆，再点击查看</span>}
                </button>

                {revealed && redbookReady && (
                  <div className="meaning-panel">
                    <div className="meaning-main">
                      <span>{currentPart}</span>
                      <strong>{currentMeaning.meaning}</strong>
                    </div>
                    {current.relation && (
                      <div className={`word-relation relation-${current.relation.kind}`}>
                        <span>词族轨道</span>
                        <div>
                          <strong>{current.relation.label}</strong>
                          <small>{current.relation.note}</small>
                        </div>
                      </div>
                    )}
                    {current.sentence ? (
                      <div className="context-block">
                        <p className="context-sentence">{current.sentence}</p>
                        <p className="context-translation">{current.translation}</p>
                      </div>
                    ) : (
                      <button className="context-block context-ai" onClick={() => { setAiOpen(true); askCoach("生成一个考研真题风格语境"); }}>
                        <span>AI 语境</span>
                        <p>生成一个考研阅读风格的例句与辨析</p>
                      </button>
                    )}
                    <div className="word-details">
                      <div><span>所在分组</span><strong>{current.section ?? selectedSection} · Unit {current.unit ?? selectedUnit}</strong></div>
                      <div><span>词汇序号</span><strong>NO. {current.id ?? wordIndex + 1}</strong></div>
                      <div><span>词表来源</span><strong>{current.sourcePage ? `正序中文词表第 ${current.sourcePage} 页` : current.family}</strong></div>
                    </div>
                  </div>
                )}
              </article>
              <div className="orbit-label orbit-label-bottom">
                {!redbookReady ? "LOCAL · REDBOOK" : revealed ? "根据真实记忆感受评分" : "SPACE · 查看释义"}
              </div>
            </div>

            <div className={revealed && redbookReady ? "rating-bar visible" : "rating-bar"}>
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
              <div><p className="eyebrow">2027 考研英语红宝书</p><h1>按红宝书顺序开始</h1></div>
              <div className="book-heading-actions">
                <span className="resource-badge">本地资源 · 6550 原书词条 · {learningItemCount} 学习项</span>
                <button className="primary-button" onClick={() => startAllBookShuffle()}>全书乱序</button>
              </div>
            </div>
            <div className="book-grid">
              {SECTION_META.map((book) => {
                const learned = new Set(reviews.filter((review) => review.section === book.name).map((review) => review.word)).size;
                return (
                <button className="book-card" key={book.name} onClick={() => {
                  setSelectedSection(book.name);
                  setSelectedUnit(book.name === "超纲词" ? "A" : 1);
                  setStudyScope("selection");
                  setRevealed(false);
                  setActiveView("learn");
                }}>
                  <span className={`book-swatch ${book.color}`}>{book.marker}</span>
                  <div>
                    <small>{book.detail}</small>
                    <h2>{book.name}</h2>
                    <p>{learned} 个已学习 · 共 {book.total} 词</p>
                  </div>
                  <div className="book-line"><i style={{ width: `${(learned / book.total) * 100}%` }} /></div>
                </button>
              )})}
              <button className="book-card empty-book all-book-card" onClick={() => startAllBookShuffle()}>
                <span>{learningItemCount}</span>
                <h2>全书乱序</h2>
                <p>保留 6550 条原书来源，变体不重复进入每日新词</p>
              </button>
            </div>
          </div>
        )}

        {activeView === "wordbook" && (
          <div className="content-view">
            <div className="section-heading wordbook-heading">
              <div>
                <p className="eyebrow">PERSONAL WORD LEDGER</p>
                <h1>把难词留在手边</h1>
              </div>
              <div className="wordbook-counts">
                <span><strong>{favoriteWords.length}</strong> 个收藏</span>
                <span><strong>{mistakeWords.length}</strong> 个错词</span>
              </div>
            </div>
            <div className="wordbook-tabs" role="tablist" aria-label="词本分类">
              <button
                role="tab"
                aria-selected={wordbookTab === "favorites"}
                className={wordbookTab === "favorites" ? "active" : ""}
                onClick={() => setWordbookTab("favorites")}
              >
                我的词本 <span>{favoriteWords.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={wordbookTab === "mistakes"}
                className={wordbookTab === "mistakes" ? "active" : ""}
                onClick={() => setWordbookTab("mistakes")}
              >
                错词记录 <span>{mistakeWords.length}</span>
              </button>
            </div>
            <div className="saved-word-grid">
              {wordbookTab === "favorites" && favoriteWords.map((item) => (
                <article className="saved-word-card" key={item.wordId}>
                  <div className="saved-word-mark">{item.word.word.slice(0, 1).toUpperCase()}</div>
                  <div className="saved-word-copy">
                    <div><h2>{item.word.word}</h2><span>{item.word.phonetic ?? item.word.part ?? splitMeaning(item.word.meaning).part}</span></div>
                    <p>{splitMeaning(item.word.meaning).meaning}</p>
                    <small>{item.word.section ?? "红宝书"} · Unit {item.word.unit ?? "—"}</small>
                  </div>
                  <div className="saved-word-actions">
                    <button onClick={() => focusSavedWord(item.word)}>去复习</button>
                    <button className="quiet" onClick={() => toggleFavorite(item.word)}>移除</button>
                  </div>
                </article>
              ))}
              {wordbookTab === "mistakes" && mistakeWords.map((item) => (
                <article className="saved-word-card mistake-card" key={item.wordId}>
                  <div className="saved-word-mark">{item.mistakeCount}</div>
                  <div className="saved-word-copy">
                    <div><h2>{item.word.word}</h2><span>{ratingLabels[item.lastRating]}</span></div>
                    <p>{splitMeaning(item.word.meaning).meaning}</p>
                    <small>累计失误 {item.mistakeCount} 次 · {item.word.section ?? "红宝书"} Unit {item.word.unit ?? "—"}</small>
                  </div>
                  <div className="saved-word-actions">
                    <button onClick={() => focusSavedWord(item.word)}>重新学习</button>
                    <button
                      className={favorites.some((favorite) => favorite.wordId === item.wordId) ? "quiet saved" : "quiet"}
                      onClick={() => toggleFavorite(item.word)}
                    >
                      {favorites.some((favorite) => favorite.wordId === item.wordId) ? "已收藏" : "加入词本"}
                    </button>
                    <button className="quiet" onClick={() => setMistakes((items) => items.filter((record) => record.wordId !== item.wordId))}>已掌握</button>
                  </div>
                </article>
              ))}
              {wordbookTab === "favorites" && favoriteWords.length === 0 && (
                <div className="wordbook-empty">
                  <span>◇</span>
                  <h2>词本还是空的</h2>
                  <p>学习时点击单词卡右上角的菱形，即可收藏。</p>
                  <button onClick={() => setActiveView("learn")}>去学习</button>
                </div>
              )}
              {wordbookTab === "mistakes" && mistakeWords.length === 0 && (
                <div className="wordbook-empty">
                  <span>✓</span>
                  <h2>暂时没有错词</h2>
                  <p>评分为“忘记”或“模糊”的单词会自动记录在这里。</p>
                  <button onClick={() => setActiveView("learn")}>继续学习</button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeView === "history" && (
          <div className="content-view">
            <div className="section-heading">
              <div><p className="eyebrow">MEMORY TRACE</p><h1>每一次回忆都算数</h1></div>
              <div className="streak"><strong>{stats.streak}</strong><span>连续学习天</span></div>
            </div>
            <div className="stat-grid">
              <div><span>今日完成</span><strong>{todayDone}</strong><small>目标 {dailyGoal}</small></div>
              <div><span>记忆强度</span><strong>{stats.memoryStrength}%</strong><small>根据主动回忆计算</small></div>
              <div><span>已到期</span><strong>{stats.dueCount}</strong><small>按最近评分时间计算</small></div>
            </div>
            <section className="activity-panel" aria-labelledby="activity-title">
              <div className="panel-title">
                <div className="activity-heading">
                  <h2 id="activity-title">背诵日历</h2>
                  <small>{activityDateRange}</small>
                </div>
                <div className="activity-panel-tools">
                  <span>{activityDays.filter((day) => day.count > 0).length} 个学习日</span>
                  <div className="activity-controls" aria-label="背诵日历范围">
                    <div className="activity-range">
                      {(Object.keys(activityRangeLabels).map(Number) as ActivityRange[]).map((range) => (
                        <button
                          type="button"
                          className={activityRange === range ? "active" : ""}
                          key={range}
                          aria-pressed={activityRange === range}
                          onClick={() => {
                            setActivityRange(range);
                            setActivityOffset(0);
                            setSelectedActivityDate("");
                          }}
                        >
                          {activityRangeLabels[range]}
                        </button>
                      ))}
                    </div>
                    <div className="activity-nav">
                      <button
                        type="button"
                        aria-label="查看更早日期"
                        title="查看更早日期"
                        onClick={() => {
                          setActivityOffset((offset) => offset + activityRange);
                          setSelectedActivityDate("");
                        }}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label="查看更近日期"
                        title="查看更近日期"
                        disabled={activityOffset === 0}
                        onClick={() => {
                          setActivityOffset((offset) => Math.max(0, offset - activityRange));
                          setSelectedActivityDate("");
                        }}
                      >
                        →
                      </button>
                    </div>
                    {activityOffset > 0 && (
                      <button
                        type="button"
                        className="activity-today"
                        onClick={() => {
                          setActivityOffset(0);
                          setSelectedActivityDate("");
                        }}
                      >
                        回到今天
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="activity-scroll">
                <div className="activity-grid" aria-label={`${activityRangeLabels[activityRange]}每日背诵数量`}>
                  {activityDays.map((day) => (
                    <button
                      type="button"
                      key={day.date}
                      className={`activity-cell level-${day.level}${day.date === dateKey(new Date(clock)) ? " today" : ""}${day.date === selectedActivityDate ? " selected" : ""}`}
                      title={`${day.date} · ${day.count} 词`}
                      aria-label={`${day.date}，背诵 ${day.count} 个单词`}
                      aria-pressed={day.date === selectedActivityDate}
                      onClick={() => setSelectedActivityDate((date) => date === day.date ? "" : day.date)}
                    />
                  ))}
                </div>
                <div className="activity-legend" aria-hidden="true">
                  <span>少</span>
                  {[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}
                  <span>多</span>
                </div>
              </div>
              {selectedActivityDate && (
                <div className="activity-detail" aria-live="polite">
                  <div className="activity-detail-head">
                    <div>
                      <strong>{selectedActivityDate.replaceAll("-", ".")}</strong>
                      <span>
                        {selectedDayReviews.length
                          ? `${selectedDayReviews.length} 个单词 · ${selectedWeakCount} 个薄弱`
                          : "当天没有学习记录"}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭日期详情"
                      onClick={() => setSelectedActivityDate("")}
                    >
                      ×
                    </button>
                  </div>
                  {selectedDayReviews.length > 0 && (
                    <div className="activity-word-list">
                      {selectedDayReviews.map((review) => (
                        <span
                          className={`activity-word rating-${review.rating}`}
                          key={`${review.wordId ?? review.word}-${review.reviewedAt}`}
                        >
                          <strong>{review.word}</strong>
                          <small>{ratingLabels[review.rating]}</small>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
            <div className="history-panel">
              <div className="panel-title"><h2>最近学习</h2><span>{reviews.length} 次记忆记录</span></div>
              {recentReviews.length ? recentReviews.map((review) => (
                <div className="history-row" key={`${review.word}-${review.reviewedAt}`}>
                  <strong>{review.word}</strong>
                  <span className={`rating-dot rating-${review.rating}`}>{ratingLabels[review.rating]}</span>
                  <span>{formatDueTime(review.dueAt, new Date(clock))}</span>
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
                <span><strong>学习顺序</strong><small>可打乱当前单元，也可跨越全书 {learningItemCount} 个学习项</small></span>
                <select
                  value={studyScope === "all" ? "all" : studyMode}
                  onChange={(event) => {
                    if (event.target.value === "all") startAllBookShuffle(false);
                    else changeStudyMode(event.target.value as StudyMode);
                  }}
                >
                  <option value="ordered">红宝书顺序</option>
                  <option value="shuffled">当前范围乱序</option>
                  <option value="all">全书 {learningItemCount} 学习项乱序</option>
                </select>
              </label>
              <label>
                <span><strong>AI 记忆教练</strong><small>已启用；未配置云端模型时自动使用本地模式</small></span>
                <span className={aiMode === "local" ? "status-pill local" : "status-pill"}>
                  {aiMode === "cloud" ? "DeepSeek 云端" : aiMode === "local" ? "本地备用" : "DeepSeek 已配置"}
                </span>
              </label>
              <button className="reset-button" onClick={() => { setReviews([]); setMistakes([]); setPositions({}); setToast("学习与错词记录已清空，收藏词本已保留"); }}>
                清空本机学习记录
              </button>
            </div>
            <div className="shortcut-panel">
              <h2>快捷键</h2>
              <div><span><kbd>Space</kbd> 查看释义</span><span><kbd>1–4</kbd> 评估记忆</span><span><kbd>F</kbd> 收藏单词</span><span><kbd>A</kbd> AI 教练</span></div>
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
          <small>{currentMeaning.meaning}</small>
        </div>
        <div className="coach-answer">
          <span>词环 AI{aiMode === "cloud" ? " · 云端" : aiMode === "local" ? " · 本地" : ""}</span>
          <p>{aiLoading ? "正在组织一个更容易记住的解释…" : aiAnswer}</p>
        </div>
        <div className="coach-prompts">
          {["给我一个记忆联想", "换个真实语境", "解释近义词区别", "出一道小测验"].map((prompt) => (
            <button key={prompt} onClick={() => askCoach(prompt)}>{prompt}</button>
          ))}
        </div>
        <form onSubmit={submitCoach}>
          <input value={aiInput} maxLength={500} onChange={(event) => setAiInput(event.target.value)} placeholder="问问这个词该怎么记…" aria-label="向 AI 教练提问" />
          <button type="submit" aria-label="发送问题">↗</button>
        </form>
        <p className="coach-note">
          {aiMode === "cloud" ? "本次由 DeepSeek 云端回答" : aiMode === "local" ? "云端不可用，本次使用本地提示" : "AI 会结合当前单词和语境回答"}
        </p>
      </aside>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
