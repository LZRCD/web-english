"use client";

import {
  ChangeEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  lookupWordId,
  MAX_REVIEWS,
  parseStoredState,
  splitMeaning,
  STORAGE_KEY,
  STORAGE_VERSION,
  type FamiliarMeaningMap,
  type LookupWord,
  type MistakeRecord,
  type Review,
  type SavedWord,
  type StudyMode,
  type StudyPositions,
  type StudyScope,
  type StoredState,
  type Word,
} from "../lib/study";
import {
  adaptiveNewWordGoal,
  applyRating,
  buildExamPlan,
  buildTodayQueue,
  createStudySession,
  dueWordIds,
  formatInterval,
  isWeakProgress,
  nextInterval,
  rebuildStubbornWords,
  rebuildWordProgress,
  resolveWeakProgress,
  sessionProgress,
  stubbornWordIds,
  weakWordIds,
  wordRetrievability,
  type StudySession,
  type StubbornWordMap,
  type WordEnrichment,
  type WordProgress,
  type WordProgressMap,
} from "../lib/learning";
import {
  createBackupDocument,
  getAutomaticBackup,
  listAutomaticBackups,
  parseBackupDocument,
  saveAutomaticBackup,
  type AutomaticBackup,
} from "../lib/backup";
import {
  loadStoredState,
  saveStoredState,
} from "../lib/storage";

type RedbookStatus = "loading" | "ready" | "error";
type ActivityRange = 140 | 182 | 365;
type AudioClip = {
  file: string;
  start: number;
  end: number;
};
type AudioIndexData = {
  entries: Record<string, AudioClip>;
};

type RatingUndo = {
  reviewId: string;
  word: Word;
  previousProgress?: WordProgress;
  previousMistake?: MistakeRecord;
  evictedReview?: Review;
  previousPosition: number;
  previousSession?: StudySession;
  studyKey: string;
  selectedSection: string;
  selectedUnit: number | string | "all";
  studyMode: StudyMode;
  studyScope: StudyScope;
  shuffleSeed: number;
};

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

type LookupResult = Omit<LookupWord, "id" | "addedAt">;
type DictionaryEntry = [displayWord: string, phonetic: string, translation: string];
type DictionaryShard = Record<string, DictionaryEntry>;

type SelectionLookup = {
  query: string;
  context: string;
  x: number;
  y: number;
  status: "idle" | "loading" | "ready" | "error";
  result?: LookupResult;
  cached?: boolean;
  error?: string;
};

type ReinforcementRating = 0 | 1;

const SECTION_META = [
  { name: "必考词", detail: "26 个单元", total: 1856, color: "mint", marker: "必" },
  { name: "基础词", detail: "31 个单元", total: 3680, color: "blue", marker: "基" },
  { name: "超纲词", detail: "按首字母编排", total: 1014, color: "peach", marker: "超" },
];

const ratingLabels = ["忘记", "模糊", "认识", "熟练"];
const sectionPriority: Record<string, number> = {
  必考词: 0,
  基础词: 1,
  超纲词: 2,
};
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
const LOOKUP_CACHE_KEY = "wordloop-selection-lookups-v1";
const DICTIONARY_BASE_PATH = "/data/dictionary";

function cleanSelectedText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'“”‘’()[\]{}.,，。;；:：!?！？]+/, "")
    .replace(/[\s"'“”‘’()[\]{}.,，。;；:：!?！？]+$/, "")
    .slice(0, 160);
}

function splitSenseItems(value: string) {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of value) {
    if ("([{（【".includes(character)) depth += 1;
    if (")]}）】".includes(character)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[;；,，]/.test(character)) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function readLookupCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOOKUP_CACHE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, LookupResult>;
  } catch {
    return {};
  }
}

function formatDictionaryPhonetic(value: string) {
  const phonetic = value.trim();
  if (!phonetic) return "";
  return /^[\/\[].*[\/\]]$/.test(phonetic) ? phonetic : `/${phonetic}/`;
}

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

function formatRecallTime(recallMs: number) {
  const seconds = recallMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} 秒` : `${Math.round(seconds)} 秒`;
}

function maskWord(value: string) {
  return value.replace(/\b([a-z])([a-z]*)\b/gi, (_, first: string, rest: string) =>
    `${first}${"·".repeat(rest.length)}`);
}

function clozeSentence(sentence: string, word: string) {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cloze = sentence.replace(new RegExp(escapedWord, "gi"), "＿＿＿＿");
  return cloze === sentence ? "" : cloze;
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
  const [wordProgress, setWordProgress] = useState<WordProgressMap>({});
  const [activeSession, setActiveSession] = useState<StudySession>();
  const [enrichments, setEnrichments] = useState<Record<number, WordEnrichment>>({});
  const [dictionaryPhonetics, setDictionaryPhonetics] = useState<Record<number, string>>({});
  const [ratingUndo, setRatingUndo] = useState<RatingUndo>();
  const [undoVisible, setUndoVisible] = useState(false);
  const [favorites, setFavorites] = useState<SavedWord[]>([]);
  const [mistakes, setMistakes] = useState<MistakeRecord[]>([]);
  const [lookupWords, setLookupWords] = useState<LookupWord[]>([]);
  const [familiarMeanings, setFamiliarMeanings] = useState<FamiliarMeaningMap>({});
  const [stubbornHistory, setStubbornHistory] = useState<StubbornWordMap>({});
  const [studyMode, setStudyMode] = useState<StudyMode>("ordered");
  const [studyScope, setStudyScope] = useState<StudyScope>("selection");
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [wordbookTab, setWordbookTab] = useState<"favorites" | "mistakes" | "stubborn" | "lookups">("favorites");
  const [pendingWordId, setPendingWordId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiAnswer, setAiAnswer] = useState("我会用语境、联想和小测验帮你真正记住这个词。");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<"unknown" | "cloud" | "local">("unknown");
  const [soundOn, setSoundOn] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [adaptiveNewWords, setAdaptiveNewWords] = useState(true);
  const [minimumNewWords, setMinimumNewWords] = useState(5);
  const [examDate, setExamDate] = useState("");
  const [recallStartedAt, setRecallStartedAt] = useState<number | null>(null);
  const [reinforcementRating, setReinforcementRating] = useState<ReinforcementRating | null>(null);
  const [reinforcementInput, setReinforcementInput] = useState("");
  const [reinforcementFeedback, setReinforcementFeedback] = useState("");
  const [reinforcementRecallMs, setReinforcementRecallMs] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [toast, setToast] = useState("");
  const [redbookWords, setRedbookWords] = useState<Word[]>([]);
  const [redbookStatus, setRedbookStatus] = useState<RedbookStatus>("loading");
  const [audioIndex, setAudioIndex] = useState<Record<string, AudioClip>>({});
  const [selectedSection, setSelectedSection] = useState("必考词");
  const [selectedUnit, setSelectedUnit] = useState<number | string | "all">(1);
  const [activityRange, setActivityRange] = useState<ActivityRange>(365);
  const [activityOffset, setActivityOffset] = useState(0);
  const [selectedActivityDate, setSelectedActivityDate] = useState("");
  const [learningItemCount, setLearningItemCount] = useState(REDBOOK_SOURCE_TOTAL);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchIds, setSelectedSearchIds] = useState<number[]>([]);
  const [automaticBackups, setAutomaticBackups] = useState<AutomaticBackup[]>([]);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [selectionLookup, setSelectionLookup] = useState<SelectionLookup>();
  const importInputRef = useRef<HTMLInputElement>(null);
  const recordedAudioRef = useRef<HTMLAudioElement>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const lookupCacheRef = useRef<Record<string, LookupResult>>({});
  const dictionaryShardCacheRef = useRef<Record<string, DictionaryShard>>({});
  const reinforcementInputRef = useRef<HTMLInputElement>(null);

  const lookupStudyWords = useMemo<Word[]>(() => lookupWords.map((item) => ({
    id: item.id,
    word: item.query,
    phonetic: item.phonetic,
    part: item.part,
    meaning: `${item.part.replace(/\.+$/, "")}. ${item.meaning}`,
    sentence: item.note,
    section: "划词集",
    unit: "自选",
  })), [lookupWords]);
  const wordById = useMemo(() => new Map(
    [...redbookWords, ...lookupStudyWords].map((word) => [word.id, word]),
  ), [lookupStudyWords, redbookWords]);
  const wordByText = useMemo(() => {
    const entries = new Map<string, Word>();
    for (const word of redbookWords) {
      const key = word.word.trim().toLowerCase();
      if (!entries.has(key)) entries.set(key, word);
    }
    return entries;
  }, [redbookWords]);
  const filteredStudyWords = useMemo(() => {
    if (redbookStatus !== "ready") return [];
    const learningWords = redbookWords.filter((word) => isPrimaryLearningWord(word.id));
    if (studyScope === "all") return learningWords;
    const sectionWords = learningWords.filter((word) => word.section === selectedSection);
    if (selectedUnit === "all") return sectionWords;
    return sectionWords.filter((word) => String(word.unit) === String(selectedUnit));
  }, [redbookStatus, redbookWords, selectedSection, selectedUnit, studyScope]);
  const freeStudyWords = useMemo(
    () => studyMode === "shuffled" ? shuffleWithSeed(filteredStudyWords, shuffleSeed) : filteredStudyWords,
    [filteredStudyWords, shuffleSeed, studyMode],
  );
  const freeStudyKey = buildStudyKey(
    studyScope,
    studyMode,
    selectedSection,
    selectedUnit,
    shuffleSeed,
  );
  const sessionWords = useMemo(
    () => activeSession?.wordIds
      .map((wordId) => wordById.get(wordId))
      .filter((word): word is Word => word !== undefined) ?? [],
    [activeSession, wordById],
  );
  const studyWords = activeSession ? sessionWords : freeStudyWords;
  const studyKey = activeSession ? `session:${activeSession.id}` : freeStudyKey;
  const wordIndex = activeSession?.index ?? positions[freeStudyKey] ?? 0;
  const sessionComplete = Boolean(
    activeSession
    && activeSession.wordIds.length > 0
    && activeSession.index >= activeSession.wordIds.length,
  );
  const currentBase = activeSession
    ? studyWords[Math.min(wordIndex, Math.max(0, studyWords.length - 1))]
    : studyWords[wordIndex % Math.max(1, studyWords.length)];
  const currentEnrichment = currentBase?.id === undefined
    ? undefined
    : enrichments[currentBase.id];
  const currentDictionaryPhonetic = currentBase?.id === undefined
    ? ""
    : dictionaryPhonetics[currentBase.id] ?? "";
  const current = currentBase
    ? {
        ...currentBase,
        phonetic: currentBase.phonetic
          || currentDictionaryPhonetic
          || undefined,
        sentence: currentEnrichment?.sentence ?? currentBase.sentence,
        translation: currentEnrichment?.translation ?? currentBase.translation,
        collocation: currentEnrichment?.collocations?.join(" · ") ?? currentBase.collocation,
      }
    : REDBOOK_PLACEHOLDER;
  const redbookReady = redbookStatus === "ready";
  const isFavorite = current.id !== undefined
    && favorites.some((item) => item.wordId === current.id);
  const stats = useMemo(
    () => learningStats(reviews, wordProgress, new Date(clock)),
    [clock, reviews, wordProgress],
  );
  const stubbornWords = useMemo(
    () => ({
      ...stubbornHistory,
      ...rebuildStubbornWords(reviews, new Date(clock)),
    }),
    [clock, reviews, stubbornHistory],
  );
  const effectiveNewGoal = adaptiveNewWordGoal({
    dailyGoal,
    minimumNewWords,
    dueCount: stats.dueCount,
    enabled: adaptiveNewWords,
  });
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
  const selectedDayEvents = useMemo(
    () => selectedActivityDate
      ? reviews.filter((review) => dateKey(review.reviewedAt) === selectedActivityDate)
      : [],
    [reviews, selectedActivityDate],
  );
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
  const selectedDayNewCount = selectedDayEvents.filter((review) => review.kind === "new").length;
  const todayKey = dateKey(new Date(clock));
  const progress = Math.min(
    100,
    Math.round((stats.newCount / Math.max(1, effectiveNewGoal)) * 100),
  );
  const currentProgress = current.id === undefined ? undefined : wordProgress[current.id];
  const ratingIntervalLabels = ([0, 1, 2, 3] as const).map((rating) =>
    formatInterval(nextInterval(currentProgress, rating, new Date(clock))));
  const activeSessionStats = sessionProgress(activeSession);
  const primaryWordIds = useMemo(
    () => redbookWords
      .filter((word) => word.id !== undefined && isPrimaryLearningWord(word.id))
      .sort((first, second) =>
        (sectionPriority[first.section ?? ""] ?? 99)
        - (sectionPriority[second.section ?? ""] ?? 99))
      .map((word) => word.id!),
    [redbookWords],
  );
  const familyKeyByWordId = useMemo(() => {
    const keys: Record<number, string> = {};
    for (const word of redbookWords) {
      if (word.id === undefined) continue;
      if (word.relation?.lemmaId) {
        const key = `lemma:${word.relation.lemmaId}`;
        keys[word.id] = key;
        keys[word.relation.lemmaId] = key;
      } else if (word.family) {
        keys[word.id] = `family:${word.family.toLowerCase()}`;
      } else if (word.root) {
        keys[word.id] = `root:${word.root.toLowerCase()}`;
      }
    }
    return keys;
  }, [redbookWords]);
  const reviewedTodayWordIds = useMemo(
    () => reviews
      .filter((review) =>
        review.wordId !== undefined
        && dateKey(review.reviewedAt) === todayKey)
      .map((review) => review.wordId!),
    [reviews, todayKey],
  );
  const remainingBySection = useMemo(() => {
    const counts = { 必考词: 0, 基础词: 0, 超纲词: 0 };
    for (const word of redbookWords) {
      if (
        word.id === undefined
        || !isPrimaryLearningWord(word.id)
        || wordProgress[word.id]
        || !(word.section && word.section in counts)
      ) {
        continue;
      }
      counts[word.section as keyof typeof counts] += 1;
    }
    return counts;
  }, [redbookWords, wordProgress]);
  const examPlan = useMemo(
    () => buildExamPlan({
      examDate,
      remainingBySection,
      dailyNewGoal: dailyGoal,
      now: new Date(clock),
    }),
    [clock, dailyGoal, examDate, remainingBySection],
  );
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
  const currentSenses = current.part
    ? [{ part: current.part, meaning: currentMeaning.meaning }]
    : currentMeaning.senses;
  const currentFamiliarMeanings = new Set(
    current.id === undefined ? [] : familiarMeanings[current.id] ?? [],
  );
  const currentMeaningItems = [
    ...new Set(currentSenses.flatMap((sense) => splitSenseItems(sense.meaning))),
  ];
  const unfamiliarMeanings = currentMeaningItems.filter(
    (meaning) => !currentFamiliarMeanings.has(meaning),
  );
  const reinforcementSentence = current.sentence
    ? clozeSentence(current.sentence, current.word)
    : "";
  const reinforcementMeaning = unfamiliarMeanings[0]
    ?? currentMeaningItems[0]
    ?? currentMeaning.meaning;
  const favoriteWords = useMemo(
    () => favorites
      .map((item) => ({ ...item, word: wordById.get(item.wordId) }))
      .filter((item): item is SavedWord & { word: Word } => item.word !== undefined),
    [favorites, wordById],
  );
  const mistakeWords = useMemo(() => {
    const existing = new Map(mistakes.map((item) => [item.wordId, item]));
    return weakWordIds(wordProgress)
      .map((wordId) => {
        const progressItem = wordProgress[wordId];
        const record = existing.get(wordId) ?? {
          wordId,
          addedAt: progressItem.firstLearnedAt,
          mistakeCount: Math.max(1, progressItem.lapseCount),
          lastRating: progressItem.lastRating <= 1 ? progressItem.lastRating : 1,
          lastMistakeAt: progressItem.lastReviewedAt,
        };
        return { ...record, word: wordById.get(wordId) };
      })
      .filter((item): item is MistakeRecord & { word: Word } => item.word !== undefined);
  }, [mistakes, wordById, wordProgress]);
  const stubbornWordList = useMemo(
    () => stubbornWordIds(stubbornWords, wordProgress)
      .map((wordId) => ({
        record: stubbornWords[wordId],
        progress: wordProgress[wordId],
        word: wordById.get(wordId),
      }))
      .filter((item): item is typeof item & { word: Word } => item.word !== undefined),
    [stubbornWords, wordById, wordProgress],
  );
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return redbookWords
      .filter((word) =>
        word.word.toLowerCase().replaceAll("-", "").includes(query.replaceAll("-", ""))
        || word.meaning.toLowerCase().includes(query)
        || String(word.id ?? "").includes(query))
      .slice(0, 40);
  }, [redbookWords, searchQuery]);
  const currentLocation = redbookStatus === "loading"
    ? "2027 红宝书 · 正在载入"
    : redbookStatus === "error"
      ? "2027 红宝书 · 读取失败"
      : activeSession
        ? `${activeSession.title} · ${activeSessionStats.completed}/${activeSessionStats.total}`
        : studyScope === "all"
        ? `全书乱序 · ${current.section ?? "红宝书"} ${current.unit ? `Unit ${current.unit}` : ""}`
        : `${current.section ?? selectedSection} · ${current.unit ? `Unit ${current.unit}` : "全书"}`;
  const persistedState = useMemo<StoredState>(() => ({
    schemaVersion: STORAGE_VERSION,
    reviews,
    wordProgress,
    favorites,
    mistakes,
    stubbornWords,
    positions,
    activeSession,
    enrichments,
    lookupWords,
    familiarMeanings,
    started,
    dailyGoal,
    adaptiveNewWords,
    minimumNewWords,
    examDate,
    soundOn,
    studyMode,
    studyScope,
    shuffleSeed,
    selectedSection,
    selectedUnit,
  }), [
    activeSession,
    adaptiveNewWords,
    dailyGoal,
    examDate,
    enrichments,
    familiarMeanings,
    favorites,
    lookupWords,
    mistakes,
    minimumNewWords,
    positions,
    reviews,
    selectedSection,
    selectedUnit,
    shuffleSeed,
    soundOn,
    started,
    stubbornWords,
    studyMode,
    studyScope,
    wordProgress,
  ]);

  useEffect(() => {
    let active = true;
    const hydration = (async () => {
      let state: StoredState | null = null;
      const legacy = localStorage.getItem(STORAGE_KEY);
      if ("indexedDB" in window) {
        try {
          state = await loadStoredState();
        } catch {}
      }
      if (!state && legacy) {
        try {
          state = parseStoredState(legacy);
          if ("indexedDB" in window) {
            try {
              await saveStoredState(state);
              localStorage.removeItem(STORAGE_KEY);
            } catch {}
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      if (!active) return;
      if (state) applyStoredState(state);
      setHydrated(true);
    })();
    Promise.all([
      fetch("/data/redbook.json").then((response) => {
        if (!response.ok) throw new Error("redbook data missing");
        return response.json() as Promise<RedbookData>;
      }),
      fetch("/data/redbook-analysis.json").then((response) => {
        if (!response.ok) throw new Error("redbook analysis missing");
        return response.json() as Promise<RedbookAnalysisData>;
      }),
      fetch("/data/audio-index.json")
        .then((response) => {
          if (!response.ok) throw new Error("audio index missing");
          return response.json() as Promise<AudioIndexData>;
        })
        .catch(() => ({ entries: {} })),
    ])
      .then(async ([data, analysis, audio]) => {
        await hydration;
        if (!active) return;
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
        setAudioIndex(audio.entries);
        setLearningItemCount(analysis.metadata.learningItemCount);
        setReviews((items) => {
          const mappedReviews = items.map((review) => review.wordId
            ? review
            : {
                ...review,
                wordId: idLookup.get(
                  `${review.section ?? ""}:${review.unit ?? ""}:${review.word.toLowerCase()}`,
                ),
              });
          setWordProgress((progressItems) => ({
            ...rebuildWordProgress(mappedReviews),
            ...progressItems,
          }));
          return mappedReviews;
        });
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
    const timer = window.setTimeout(() => {
      if (!("indexedDB" in window)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
        return;
      }
      saveStoredState(persistedState)
        .then(() => localStorage.removeItem(STORAGE_KEY))
        .catch(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState)));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hydrated, persistedState]);

  useEffect(() => {
    if (!hydrated || !("indexedDB" in window)) return;
    let active = true;
    listAutomaticBackups()
      .then((items) => {
        if (active) setAutomaticBackups(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !("indexedDB" in window)) return;
    const backupKey = "wordloop-last-auto-backup";
    if (localStorage.getItem(backupKey) !== todayKey) {
      localStorage.setItem(backupKey, todayKey);
      saveAutomaticBackup(persistedState, "daily")
        .then((items) => {
          setAutomaticBackups(items);
        })
        .catch(() => localStorage.removeItem(backupKey));
    }
  }, [hydrated, persistedState, todayKey]);

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
    lookupCacheRef.current = readLookupCache();
  }, []);

  useEffect(() => {
    if (
      currentBase?.id === undefined
      || !currentBase.word
      || currentBase.phonetic
      || currentDictionaryPhonetic
    ) return;
    let active = true;
    findInLocalDictionary(currentBase.word)
      .then((result) => {
        if (active && result?.phonetic) {
          setDictionaryPhonetics((items) => ({
            ...items,
            [currentBase.id!]: result.phonetic,
          }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    currentBase?.id,
    currentBase?.phonetic,
    currentBase?.word,
    currentDictionaryPhonetic,
  ]);

  useEffect(() => {
    if (!selectionLookup) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".selection-lookup")) return;
      lookupAbortRef.current?.abort();
      setSelectionLookup(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [selectionLookup]);

  useEffect(() => () => {
    recordedAudioRef.current?.pause();
    window.speechSynthesis?.cancel();
    lookupAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    lookupAbortRef.current?.abort();
    queueMicrotask(() => setSelectionLookup(undefined));
  }, [current.id]);

  useEffect(() => {
    if (activeSession?.kind !== "today") return;
    const dueNow = dueWordIds(wordProgress, new Date(clock));
    const queued = new Set(activeSession.wordIds);
    const additions = dueNow.filter((wordId) => !queued.has(wordId));
    if (!additions.length) return;
    queueMicrotask(() => setActiveSession((session) =>
      session?.kind === "today"
        ? { ...session, wordIds: [...session.wordIds, ...additions] }
        : session));
  }, [activeSession, clock, wordProgress]);

  useEffect(() => {
    if (
      hydrated
      && activeSession?.kind === "today"
      && dateKey(activeSession.createdAt) !== todayKey
    ) {
      queueMicrotask(() => setActiveSession(undefined));
    }
  }, [activeSession, hydrated, todayKey]);

  useEffect(() => {
    if (!redbookReady || selectedUnit === "all" || availableUnits.includes(String(selectedUnit))) return;
    queueMicrotask(() => setSelectedUnit(selectedSection === "超纲词" ? "A" : 1));
  }, [availableUnits, redbookReady, selectedSection, selectedUnit]);

  useEffect(() => {
    if (!started || !redbookReady || current.id === undefined) return;
    queueMicrotask(() => setRecallStartedAt(Date.now()));
  }, [current.id, redbookReady, started]);

  useEffect(() => {
    if (reinforcementRating === null) return;
    reinforcementInputRef.current?.focus();
  }, [reinforcementRating]);

  useEffect(() => {
    if (revealed) return;
    queueMicrotask(() => {
      setReinforcementRating(null);
      setReinforcementInput("");
      setReinforcementFeedback("");
      setReinforcementRecallMs(null);
    });
  }, [revealed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setAiOpen(false);
        setSelectionLookup(undefined);
        lookupAbortRef.current?.abort();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!started) beginLearning();
        else if (activeView === "learn" && redbookReady) setRevealed(true);
      }
      if (event.key.toLowerCase() === "a" && started) setAiOpen((value) => !value);
      if (
        event.key.toLowerCase() === "e"
        && started
        && activeView === "learn"
        && revealed
        && redbookReady
        && !current.sentence
        && !enrichmentLoading
      ) {
        enrichCurrentWord();
      }
      if (event.key.toLowerCase() === "f" && started && activeView === "learn") toggleFavorite();
      if (event.key.toLowerCase() === "z" && ratingUndo) undoLastRating();
      if (event.key === "/") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) rateWord(Number(event.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function applyStoredState(state: StoredState) {
    setReviews(state.reviews);
    setWordProgress(state.wordProgress);
    setPositions(state.positions);
    setActiveSession(state.activeSession);
    setEnrichments(state.enrichments);
    setLookupWords(state.lookupWords);
    setFamiliarMeanings(state.familiarMeanings);
    setStarted(state.started);
    setDailyGoal(state.dailyGoal);
    setAdaptiveNewWords(state.adaptiveNewWords);
    setMinimumNewWords(state.minimumNewWords);
    setExamDate(state.examDate);
    setSoundOn(state.soundOn);
    setFavorites(state.favorites);
    setMistakes(state.mistakes);
    setStubbornHistory(state.stubbornWords);
    setStudyMode(state.studyMode);
    setStudyScope(state.studyScope);
    setShuffleSeed(state.shuffleSeed);
    setSelectedSection(state.selectedSection);
    setSelectedUnit(state.selectedUnit);
    setRatingUndo(undefined);
    setUndoVisible(false);
    setClock(Date.now());
  }

  function beginLearning() {
    setStarted(true);
    setRecallStartedAt(Date.now());
  }

  function exportBackup() {
    const document = createBackupDocument(persistedState);
    const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `wordloop-backup-${todayKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("词环备份已导出");
    setTimeout(() => setToast(""), 1800);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const document = parseBackupDocument(await file.text());
      const state = parseStoredState(JSON.stringify(document.state));
      const confirmed = window.confirm(
        `备份时间：${new Date(document.exportedAt).toLocaleString("zh-CN")}\n`
        + `评分记录：${state.reviews.length} 条\n`
        + `已学习：${Object.keys(state.wordProgress).length} 词\n`
        + `收藏：${state.favorites.length} 词\n\n`
        + "导入会完整替换当前学习状态，是否继续？",
      );
      if (!confirmed) return;
      if ("indexedDB" in window) {
        const items = await saveAutomaticBackup(persistedState, "before-import");
        setAutomaticBackups(items);
      }
      applyStoredState(state);
      setToast(`已导入 ${state.reviews.length} 条评分记录`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "备份导入失败");
    }
    setTimeout(() => setToast(""), 2400);
  }

  async function restoreBackup(id: string) {
    try {
      const backup = await getAutomaticBackup(id);
      if (!backup) throw new Error("找不到这份自动备份");
      if (!window.confirm(`恢复 ${new Date(backup.createdAt).toLocaleString("zh-CN")} 的自动备份？`)) {
        return;
      }
      const items = await saveAutomaticBackup(persistedState, "manual");
      setAutomaticBackups(items);
      applyStoredState(parseStoredState(JSON.stringify(backup.document.state)));
      setToast("已恢复自动备份，恢复前状态也已保存");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "自动备份恢复失败");
    }
    setTimeout(() => setToast(""), 2400);
  }

  async function resetLearningRecords() {
    if (!window.confirm("确定清空评分、记忆状态、错词和学习位置吗？收藏与内容缓存会保留。")) {
      return;
    }
    try {
      if ("indexedDB" in window) {
        const items = await saveAutomaticBackup(persistedState, "manual");
        setAutomaticBackups(items);
      }
    } catch {}
    setReviews([]);
    setWordProgress({});
    setMistakes([]);
    setStubbornHistory({});
    setPositions({});
    setActiveSession(undefined);
    setRatingUndo(undefined);
    setToast("学习记录已清空，收藏和内容缓存已保留");
    setTimeout(() => setToast(""), 1800);
  }

  function speakWithTts(word: Word) {
    if (!("speechSynthesis" in window)) {
      setToast("当前浏览器不支持语音播放");
      return false;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.word);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function playRecordedWord(word: Word) {
    const clip = word.id === undefined ? undefined : audioIndex[String(word.id)];
    if (!clip) return false;
    window.speechSynthesis?.cancel();
    const audio = recordedAudioRef.current ?? new Audio();
    recordedAudioRef.current = audio;
    audio.pause();
    audio.preload = "auto";
    audio.src = `${clip.file}#t=${clip.start},${clip.end}`;
    audio.currentTime = clip.start;
    audio.ontimeupdate = () => {
      if (audio.currentTime >= clip.end) {
        audio.pause();
        audio.currentTime = clip.start;
      }
    };
    let fallbackUsed = false;
    const fallback = () => {
      if (fallbackUsed) return;
      fallbackUsed = true;
      audio.pause();
      speakWithTts(word);
    };
    audio.onerror = fallback;
    audio.play().catch(fallback);
    return true;
  }

  function speak() {
    if (!redbookReady) return;
    if (!playRecordedWord(current)) speakWithTts(current);
  }

  function rateWord(rating: number, skipReinforcement = false) {
    if (
      !redbookReady
      || current.id === undefined
      || rating < 0
      || rating > 3
      || sessionComplete
    ) return;
    const measuredRecallMs = recallStartedAt === null
      ? undefined
      : Math.max(0, Date.now() - recallStartedAt);
    if (rating <= 1 && !skipReinforcement && reinforcementRating === null) {
      setReinforcementRating(rating as ReinforcementRating);
      setReinforcementInput("");
      setReinforcementFeedback("");
      setReinforcementRecallMs(measuredRecallMs ?? null);
      return;
    }
    const now = new Date().toISOString();
    const recallMs = skipReinforcement && reinforcementRecallMs !== null
      ? reinforcementRecallMs
      : measuredRecallMs;
    const typedRating = rating as 0 | 1 | 2 | 3;
    const previousProgress = wordProgress[current.id];
    const previousMistake = mistakes.find((item) => item.wordId === current.id);
    const result = applyRating(previousProgress, {
      wordId: current.id,
      word: current.word,
      rating: typedRating,
      reviewedAt: now,
      recallMs,
      section: current.section,
      unit: current.unit,
    });
    setRatingUndo({
      reviewId: result.review.id,
      word: current,
      previousProgress,
      previousMistake,
      evictedReview: reviews.length >= MAX_REVIEWS ? reviews[0] : undefined,
      previousPosition: wordIndex,
      previousSession: activeSession ? { ...activeSession, wordIds: [...activeSession.wordIds] } : undefined,
      studyKey,
      selectedSection,
      selectedUnit,
      studyMode,
      studyScope,
      shuffleSeed,
    });
    setUndoVisible(true);
    setWordProgress((items) => ({ ...items, [current.id!]: result.progress }));
    if (typedRating <= 1) {
      setMistakes((items) => {
        const previous = items.find((item) => item.wordId === current.id);
        const record: MistakeRecord = {
          wordId: current.id!,
          addedAt: previous?.addedAt ?? now,
          mistakeCount: (previous?.mistakeCount ?? 0) + 1,
          lastRating: typedRating,
          lastMistakeAt: now,
        };
        return [record, ...items.filter((item) => item.wordId !== current.id)];
      });
    } else if (!isWeakProgress(result.progress)) {
      setMistakes((items) => items.filter((item) => item.wordId !== current.id));
    }
    setReviews((items) => [...items, result.review].slice(-MAX_REVIEWS));
    const recallMessage = recallMs === undefined
      ? ""
      : ` · 用时 ${formatRecallTime(recallMs)}${recallMs >= 15000 ? "，回忆偏慢" : ""}`;
    setToast(`${ratingLabels[typedRating]} · ${formatInterval(result.review.intervalMs)}后复习${recallMessage} · Z 撤销`);
    setReinforcementRating(null);
    setReinforcementInput("");
    setReinforcementFeedback("");
    setReinforcementRecallMs(null);
    setRevealed(false);
    if (activeSession) {
      setActiveSession((session) => session
        ? { ...session, index: Math.min(session.wordIds.length, session.index + 1) }
        : session);
    } else {
      setPositions((items) => ({
        ...items,
        [studyKey]: (wordIndex + 1) % Math.max(1, studyWords.length),
      }));
    }
    setClock(Date.now());
    setRecallStartedAt(Date.now());
    setAiAnswer("我会用语境、联想和小测验帮你真正记住这个词。");
    setAiMode("unknown");
    if (soundOn && (!activeSession || wordIndex + 1 < studyWords.length)) {
      setTimeout(speakNext, 80);
    }
    setTimeout(() => {
      setToast("");
      setUndoVisible(false);
    }, 5000);
  }

  function undoLastRating() {
    if (!ratingUndo) return;
    window.speechSynthesis?.cancel();
    setReviews((items) => {
      const rest = items.filter((review) => review.id !== ratingUndo.reviewId);
      return ratingUndo.evictedReview ? [ratingUndo.evictedReview, ...rest] : rest;
    });
    setWordProgress((items) => {
      const next = { ...items };
      if (ratingUndo.previousProgress) {
        next[ratingUndo.word.id!] = ratingUndo.previousProgress;
      } else {
        delete next[ratingUndo.word.id!];
      }
      return next;
    });
    setMistakes((items) => {
      const rest = items.filter((item) => item.wordId !== ratingUndo.word.id);
      return ratingUndo.previousMistake
        ? [ratingUndo.previousMistake, ...rest]
        : rest;
    });
    setSelectedSection(ratingUndo.selectedSection);
    setSelectedUnit(ratingUndo.selectedUnit);
    setStudyMode(ratingUndo.studyMode);
    setStudyScope(ratingUndo.studyScope);
    setShuffleSeed(ratingUndo.shuffleSeed);
    if (ratingUndo.previousSession) {
      setActiveSession(ratingUndo.previousSession);
    } else {
      setActiveSession(undefined);
      setPositions((items) => ({
        ...items,
        [ratingUndo.studyKey]: ratingUndo.previousPosition,
      }));
    }
    setActiveView("learn");
    setRevealed(true);
    setRecallStartedAt(Date.now());
    setRatingUndo(undefined);
    setUndoVisible(false);
    setToast(`已撤销 ${ratingUndo.word.word} 的最近评分`);
    setClock(Date.now());
    setTimeout(() => setToast(""), 1800);
  }

  function changeStudyMode(mode: StudyMode) {
    setActiveSession(undefined);
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
    setActiveSession(undefined);
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

  function startSession(kind: StudySession["kind"], title: string, wordIds: number[]) {
    if (!wordIds.length) {
      setToast("当前没有可加入学习队列的单词");
      setTimeout(() => setToast(""), 1800);
      return;
    }
    setActiveSession(createStudySession(kind, title, wordIds));
    beginLearning();
    setRevealed(false);
    setActiveView("learn");
    setToast(`已建立${title} · ${wordIds.length} 词`);
    setTimeout(() => setToast(""), 1800);
  }

  function startTodaySession() {
    startSession(
      "today",
      "今日任务",
      buildTodayQueue(
        primaryWordIds,
        wordProgress,
        Math.max(0, effectiveNewGoal - stats.newCount),
        new Date(clock),
        {
          familyKeyByWordId,
          reviewedTodayWordIds,
        },
      ),
    );
  }

  function startFavoriteSession() {
    startSession("favorites", "收藏复习", favorites.map((item) => item.wordId));
  }

  function startMistakeSession() {
    startSession("mistakes", "错词强化", weakWordIds(wordProgress));
  }

  function startStubbornSession() {
    startSession(
      "mistakes",
      "顽固词专项",
      stubbornWordIds(stubbornWords, wordProgress),
    );
  }

  function startLookupSession(wordIds = lookupWords.map((item) => item.id)) {
    startSession("lookups", "划词集复习", wordIds);
  }

  function startSearchSession() {
    const ids = selectedSearchIds.length
      ? selectedSearchIds
      : searchResults.map((word) => word.id).filter((id): id is number => id !== undefined);
    startSession("search", "搜索专项学习", ids);
    setSearchOpen(false);
    setSelectedSearchIds([]);
  }

  function markMistakeResolved(wordId: number) {
    const progressItem = wordProgress[wordId];
    if (progressItem) {
      setWordProgress((items) => ({
        ...items,
        [wordId]: resolveWeakProgress(progressItem, new Date().toISOString()),
      }));
    }
    setMistakes((items) => items.filter((record) => record.wordId !== wordId));
    setToast("已移出当前薄弱词，历史评分仍会保留");
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

  function toggleMeaningFamiliar(meaning: string) {
    if (current.id === undefined) return;
    setFamiliarMeanings((items) => {
      const existing = items[current.id!] ?? [];
      const next = existing.includes(meaning)
        ? existing.filter((item) => item !== meaning)
        : [...existing, meaning];
      if (!next.length) {
        return Object.fromEntries(
          Object.entries(items).filter(([wordId]) => Number(wordId) !== current.id),
        );
      }
      return { ...items, [current.id!]: next };
    });
  }

  function focusSavedWord(word: Word) {
    const section = word.section ?? selectedSection;
    const unit = word.unit ?? "all";
    setSelectedSection(section);
    setSelectedUnit(unit);
    setStudyScope("selection");
    setActiveSession(undefined);
    setPendingWordId(word.id ?? null);
    setRevealed(false);
    setActiveView("learn");
  }

  function speakNext() {
    const nextWord = studyWords[(wordIndex + 1) % Math.max(1, studyWords.length)] ?? REDBOOK_PLACEHOLDER;
    if (!playRecordedWord(nextWord)) speakWithTts(nextWord);
  }

  async function handleTextSelection(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return;

    const query = cleanSelectedText(selection.toString());
    if (!query || !/[A-Za-z]/.test(query)) return;
    const rangeBox = range.getBoundingClientRect();
    if (!rangeBox.width && !rangeBox.height) return;
    const popupWidth = Math.min(360, window.innerWidth - 24);
    const x = Math.min(
      window.innerWidth - popupWidth / 2 - 12,
      Math.max(popupWidth / 2 + 12, rangeBox.left + rangeBox.width / 2),
    );
    const popupHeight = 220;
    const y = rangeBox.bottom + 12 + popupHeight <= window.innerHeight
      ? rangeBox.bottom + 12
      : Math.max(12, rangeBox.top - popupHeight - 12);
    const commonNode = range.commonAncestorContainer;
    const commonElement = commonNode.nodeType === Node.ELEMENT_NODE
      ? commonNode as Element
      : commonNode.parentElement;
    const contextElement = commonElement?.closest(
      ".meaning-row, .context-block, .collocation-block, .word-face",
    );
    const context = (contextElement?.textContent ?? current.sentence ?? current.meaning)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    lookupAbortRef.current?.abort();
    setSelectionLookup({ query, context, x, y, status: "idle" });
  }

  function saveLookupWord(result: LookupResult) {
    setLookupWords((items) => {
      const existing = items.find(
        (item) => item.query.toLowerCase() === result.query.toLowerCase(),
      );
      return [
        {
          ...result,
          id: existing?.id ?? lookupWordId(result.query),
          addedAt: existing?.addedAt ?? new Date().toISOString(),
        },
        ...items.filter((item) => item.query.toLowerCase() !== result.query.toLowerCase()),
      ].slice(0, 200);
    });
  }

  async function findInLocalDictionary(query: string): Promise<LookupResult | null> {
    if (!/^[A-Za-z][A-Za-z '-]*$/.test(query)) return null;
    const shardName = query[0].toLowerCase();
    let shard = dictionaryShardCacheRef.current[shardName];
    if (!shard) {
      const response = await fetch(`${DICTIONARY_BASE_PATH}/${shardName}.json`);
      if (!response.ok) return null;
      shard = await response.json() as DictionaryShard;
      dictionaryShardCacheRef.current[shardName] = shard;
    }
    const entry = shard[query.toLowerCase()];
    if (!entry) return null;
    return {
      query: entry[0],
      kind: entry[0].includes(" ") ? "phrase" : "word",
      phonetic: formatDictionaryPhonetic(entry[1]),
      phoneticSource: "dictionary",
      part: "本地词典",
      meaning: entry[2].replace(/\\n/g, "；").replace(/\s*;\s*/g, "；"),
      note: "ECDICT 离线释义",
      source: "dictionary",
    };
  }

  async function translateSelection(options: { forceAi?: boolean } = {}) {
    if (!selectionLookup || selectionLookup.status === "loading") return;
    const { query, context, x, y } = selectionLookup;
    const normalizedQuery = query.toLowerCase();
    const localWord = wordByText.get(normalizedQuery);
    if (localWord && !options.forceAi) {
      const parsed = splitMeaning(localWord.meaning);
      const dictionaryResult = localWord.phonetic
        ? null
        : await findInLocalDictionary(query).catch(() => null);
      const phonetic = localWord.phonetic || dictionaryResult?.phonetic || "";
      if (localWord.id !== undefined && phonetic) {
        setDictionaryPhonetics((items) => ({ ...items, [localWord.id!]: phonetic }));
      }
      const result: LookupResult = {
        query: localWord.word,
        kind: localWord.word.includes(" ") ? "phrase" : "word",
        phonetic,
        phoneticSource: localWord.phonetic ? "redbook" : phonetic ? "dictionary" : undefined,
        part: localWord.part ?? parsed.part,
        meaning: parsed.meaning,
        note: `${localWord.section ?? "红宝书"}${localWord.unit ? ` · Unit ${localWord.unit}` : ""}`,
        source: "redbook",
      };
      saveLookupWord(result);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result,
      });
      return;
    }

    const savedLookup = lookupWords.find(
      (item) => item.query.toLowerCase() === normalizedQuery,
    );
    if (savedLookup && !options.forceAi) {
      const dictionaryResult = savedLookup.source === "ai"
        ? await findInLocalDictionary(query).catch(() => null)
        : null;
      const result: LookupResult = {
        query: savedLookup.query,
        kind: savedLookup.kind,
        phonetic: savedLookup.source === "ai"
          ? dictionaryResult?.phonetic ?? ""
          : savedLookup.phonetic,
        phoneticSource: savedLookup.source === "ai"
          ? dictionaryResult?.phoneticSource
          : savedLookup.phoneticSource,
        part: savedLookup.part,
        meaning: savedLookup.meaning,
        note: savedLookup.note,
        source: savedLookup.source,
      };
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result,
        cached: true,
      });
      return;
    }

    const cacheKey = JSON.stringify([normalizedQuery, context.toLowerCase()]);
    const cached = lookupCacheRef.current[cacheKey];
    if (cached && (!options.forceAi || cached.source === "ai")) {
      const trustedCached = cached.source === "ai"
        ? {
            ...cached,
            phonetic: selectionLookup.result?.phonetic || (
              cached.phoneticSource ? cached.phonetic : ""
            ),
            phoneticSource: selectionLookup.result?.phoneticSource
              ?? cached.phoneticSource,
          }
        : cached;
      saveLookupWord(trustedCached);
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "ready",
        result: trustedCached,
        cached: true,
      });
      return;
    }

    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setSelectionLookup({ query, context, x, y, status: "loading" });
    try {
      if (!options.forceAi) {
        const dictionaryResult = await findInLocalDictionary(query);
        if (dictionaryResult) {
          saveLookupWord(dictionaryResult);
          setSelectionLookup({
            query,
            context,
            x,
            y,
            status: "ready",
            result: dictionaryResult,
          });
          return;
        }
      }
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query, context }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30000),
        ]),
      });
      const data = await response.json() as LookupResult & { error?: string };
      if (!response.ok || data.source !== "ai") {
        throw new Error(data.error ?? "划词查询失败");
      }
      const trustedResult: LookupResult = {
        ...data,
        phonetic: selectionLookup.result?.phonetic || "",
        phoneticSource: selectionLookup.result?.phoneticSource,
      };
      const entries = Object.entries({
        ...lookupCacheRef.current,
        [cacheKey]: trustedResult,
      }).slice(-120);
      lookupCacheRef.current = Object.fromEntries(entries);
      localStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify(lookupCacheRef.current));
      saveLookupWord(trustedResult);
      setSelectionLookup({ query, context, x, y, status: "ready", result: trustedResult });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSelectionLookup({
        query,
        context,
        x,
        y,
        status: "error",
        error: error instanceof Error ? error.message : "划词查询失败",
      });
    }
  }

  function submitReinforcement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reinforcementRating === null) return;
    const answer = reinforcementInput.trim().toLocaleLowerCase();
    const expected = current.word.trim().toLocaleLowerCase();
    if (answer !== expected) {
      setReinforcementFeedback(`还差一点，按词形 ${maskWord(current.word)} 再拼一次`);
      reinforcementInputRef.current?.select();
      return;
    }
    rateWord(reinforcementRating, true);
  }

  function skipReinforcement() {
    if (reinforcementRating === null) return;
    rateWord(reinforcementRating, true);
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

  async function enrichCurrentWord() {
    if (current.id === undefined || enrichmentLoading) return;
    if (!unfamiliarMeanings.length) {
      setToast("所有中文义项都已标记熟练，请先取消一个义项");
      setTimeout(() => setToast(""), 2400);
      return;
    }
    setEnrichmentLoading(true);
    try {
      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: current.word,
          meaning: unfamiliarMeanings.join("；"),
          familiarMeanings: [...currentFamiliarMeanings],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json() as WordEnrichment & { error?: string };
      if (!response.ok || data.source !== "ai") {
        throw new Error(data.error ?? "内容补充失败");
      }
      setEnrichments((items) => ({ ...items, [current.id!]: data }));
      setToast(`已按 ${unfamiliarMeanings.length} 个未熟练义项生成并缓存`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "内容补充失败");
    } finally {
      setEnrichmentLoading(false);
      setTimeout(() => setToast(""), 2400);
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
        <button className="welcome" onClick={beginLearning} aria-label="开始学习">
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
                ? activeSession
                  ? `${activeSession.title} · ${activeSessionStats.completed}/${activeSessionStats.total}`
                  : studyScope === "all"
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
                      setActiveSession(undefined);
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
                      setActiveSession(undefined);
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
          <button className="search-trigger" type="button" onClick={() => setSearchOpen(true)}>
            <span>⌕</span> 查词 <kbd>/</kbd>
          </button>
          <div className="daily-progress" aria-label={`今日新学 ${stats.newCount} 个，当前目标 ${effectiveNewGoal} 个`}>
            <span>{stats.newCount}</span>
            <i />
            <span>{effectiveNewGoal}</span>
          </div>
        </header>

        {activeView === "learn" && (
          <div className="learn-view">
            {!activeSession && redbookReady && (
              <button className="today-task-strip" onClick={startTodaySession}>
                <span>今日任务</span>
                <strong>{stats.dueCount} 个到期复习 · 还可新学 {Math.max(0, effectiveNewGoal - stats.newCount)} 词</strong>
                <small>开始 →</small>
              </button>
            )}
            {sessionComplete && activeSession && (
              <div className="session-complete">
                <span>✓</span>
                <p className="eyebrow">{activeSession.title}</p>
                <h1>本次学习完成</h1>
                <p>已完成 {activeSession.wordIds.length} 次学习任务，评分结果已进入复习计划。</p>
                <div>
                  <button onClick={startTodaySession}>刷新今日任务</button>
                  <button className="quiet" onClick={() => setActiveSession(undefined)}>返回自由学习</button>
                </div>
              </div>
            )}
            {!sessionComplete && (
              <>
            <div className="orbit-stage" style={{ "--progress": `${Math.max(progress, 4)}%` } as React.CSSProperties}>
              <div className="orbit-label orbit-label-top">NEW · {currentLocation}</div>
              <article
                className={`${revealed ? "word-card revealed" : "word-card"}${reinforcementRating === null ? "" : " reinforcing"}${redbookReady ? "" : " loading"}`}
                aria-busy={redbookStatus === "loading"}
                onMouseUp={handleTextSelection}
              >
                <div className="word-heading">
                  <p className="word-count">
                    {redbookReady
                      ? activeSession
                        ? `${String(Math.min(activeSession.index + 1, activeSession.wordIds.length)).padStart(2, "0")} / ${activeSession.wordIds.length}`
                        : `${String(stats.newCount).padStart(2, "0")} 新词`
                      : "— / —"}
                  </p>
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
                    <button
                      className="sound-button"
                      onClick={speak}
                      disabled={!redbookReady}
                      aria-label={`播放 ${current.word} 的发音`}
                      title={current.id !== undefined && audioIndex[String(current.id)]
                        ? "2027 红宝书原声"
                        : "浏览器 TTS 回退"}
                    >
                      ◖))
                    </button>
                  </div>
                </div>
                <button className="word-face" onClick={() => redbookReady && setRevealed(true)} disabled={!redbookReady} aria-label="显示单词释义">
                  <h1>{reinforcementRating === null ? current.word : maskWord(current.word)}</h1>
                  <p>
                    {redbookReady
                      ? reinforcementRating === null
                        ? (current.phonetic || "\u00A0")
                        : `${current.word.replace(/\s/g, "").length} LETTERS`
                      : "LOCAL VOCABULARY"}
                  </p>
                  {!redbookReady
                    ? <span>{redbookStatus === "loading" ? "正在读取 6550 个考研词汇…" : "未能读取本地红宝书词库"}</span>
                    : !revealed && <span>先在脑中回忆，再点击查看</span>}
                </button>

                {revealed && redbookReady && reinforcementRating === null && (
                  <div className="meaning-panel">
                    <div className="meaning-main">
                      {currentSenses.map((sense) => (
                        <div className="meaning-row" key={sense.part}>
                          <span>{sense.part}</span>
                          <div className="meaning-sense-list">
                            {splitSenseItems(sense.meaning).map((meaning) => {
                              const familiar = currentFamiliarMeanings.has(meaning);
                              return (
                                <button
                                  type="button"
                                  className={familiar ? "meaning-sense familiar" : "meaning-sense"}
                                  key={meaning}
                                  onClick={() => toggleMeaningFamiliar(meaning)}
                                  aria-pressed={familiar}
                                  title={familiar ? "取消熟练标记" : "标记为熟练义项"}
                                >
                                  {meaning}
                                  {familiar && <small>✓ 熟练</small>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
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
                        {currentEnrichment && (
                          <div className="content-meta">
                            <small className="content-source">
                              {currentEnrichment.source === "ai" ? "AI 生成 · 已缓存 · 未人工核验" : "词典内容"}
                              {currentEnrichment.targetMeanings?.length
                                ? ` · 针对：${currentEnrichment.targetMeanings.join("、")}`
                                : ""}
                            </small>
                            {currentEnrichment.source === "ai" && (
                              <button
                                type="button"
                                onClick={enrichCurrentWord}
                                disabled={enrichmentLoading || !unfamiliarMeanings.length}
                              >
                                {enrichmentLoading ? "重写中…" : "按未熟练义项重写"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        className="context-block context-ai"
                        onClick={enrichCurrentWord}
                        disabled={enrichmentLoading || !unfamiliarMeanings.length}
                        aria-keyshortcuts="E"
                      >
                        <span>内容补充 <kbd>E</kbd></span>
                        <p>
                          {!unfamiliarMeanings.length
                            ? "全部中文义项已标记熟练"
                            : enrichmentLoading
                            ? "正在按未熟练义项生成并校验格式…"
                            : `按 ${unfamiliarMeanings.length} 个未熟练义项生成例句与搭配`}
                        </p>
                      </button>
                    )}
                    {current.collocation && (
                      <div className="collocation-block">
                        <span>常用搭配</span>
                        <p>{current.collocation}</p>
                      </div>
                    )}
                    <div className="word-details">
                      <div><span>所在分组</span><strong>{current.section ?? selectedSection} · Unit {current.unit ?? selectedUnit}</strong></div>
                      <div><span>词汇序号</span><strong>NO. {current.id ?? wordIndex + 1}</strong></div>
                      <div>
                        <span>下次复习</span>
                        <strong>
                          {currentProgress
                            ? formatDueTime(currentProgress.nextDueAt, new Date(clock))
                            : "首次学习"}
                        </strong>
                      </div>
                      {currentProgress && (
                        <div>
                          <span>FSRS 可提取率</span>
                          <strong>{wordRetrievability(currentProgress, new Date(clock))}%</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {revealed && redbookReady && reinforcementRating !== null && (
                  <form className="reinforcement-panel" onSubmit={submitReinforcement}>
                    <div className="reinforcement-heading">
                      <span>{reinforcementRating === 0 ? "忘记后再认" : "模糊后加固"}</span>
                      <strong>趁答案还在短时记忆里，再主动提取一次</strong>
                    </div>
                    <div className="reinforcement-cue">
                      <small>{reinforcementSentence ? "语境填空" : "核心含义"}</small>
                      <p>{reinforcementSentence || reinforcementMeaning}</p>
                      {reinforcementRating === 0 && (current.relation || current.root) && (
                        <em>{current.relation?.label ?? `词根提示：${current.root}`}</em>
                      )}
                    </div>
                    <label className="reinforcement-input">
                      <span>输入完整单词</span>
                      <input
                        ref={reinforcementInputRef}
                        value={reinforcementInput}
                        onChange={(event) => {
                          setReinforcementInput(event.target.value);
                          setReinforcementFeedback("");
                        }}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-describedby="reinforcement-feedback"
                      />
                    </label>
                    <div className="reinforcement-actions">
                      <button type="submit" disabled={!reinforcementInput.trim()}>完成强化</button>
                      <button type="button" className="quiet" onClick={skipReinforcement}>暂时跳过</button>
                    </div>
                    <p
                      id="reinforcement-feedback"
                      className={reinforcementFeedback ? "reinforcement-feedback error" : "reinforcement-feedback"}
                      aria-live="polite"
                    >
                      {reinforcementFeedback || "只增加这一道短题，完成后自动进入下一词"}
                    </p>
                  </form>
                )}
              </article>
              <div className="orbit-label orbit-label-bottom">
                {!redbookReady
                  ? "LOCAL · REDBOOK"
                  : reinforcementRating !== null
                    ? "RETRIEVE · 再提取一次"
                    : revealed
                      ? "根据真实记忆感受评分"
                      : "SPACE · 查看释义"}
              </div>
            </div>

            <div className={revealed && redbookReady && reinforcementRating === null ? "rating-bar visible" : "rating-bar"}>
              {ratingLabels.map((label, index) => (
                <button key={label} onClick={() => rateWord(index)}>
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                  <small>{ratingIntervalLabels[index]}</small>
                </button>
              ))}
            </div>
              </>
            )}
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
                const bookWordIds = redbookWords
                  .filter((word) => word.section === book.name && word.id !== undefined && isPrimaryLearningWord(word.id))
                  .map((word) => word.id!);
                const learned = bookWordIds.filter((wordId) => wordProgress[wordId]).length;
                const mastered = bookWordIds.filter((wordId) => wordProgress[wordId]?.status === "mastered").length;
                const due = new Set(dueWordIds(wordProgress, new Date(clock)));
                const dueCount = bookWordIds.filter((wordId) => due.has(wordId)).length;
                return (
                <button className="book-card" key={book.name} onClick={() => {
                  setSelectedSection(book.name);
                  setSelectedUnit(book.name === "超纲词" ? "A" : 1);
                  setStudyScope("selection");
                  setActiveSession(undefined);
                  setRevealed(false);
                  setActiveView("learn");
                }}>
                  <span className={`book-swatch ${book.color}`}>{book.marker}</span>
                  <div>
                    <small>{book.detail}</small>
                    <h2>{book.name}</h2>
                    <p>{learned} 已学习 · {mastered} 已掌握 · {dueCount} 待复习</p>
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
                <span><strong>{stubbornWordList.length}</strong> 个顽固词</span>
                <span><strong>{lookupWords.length}</strong> 个划词</span>
              </div>
              <div className="wordbook-batch-actions">
                <button onClick={startFavoriteSession} disabled={!favoriteWords.length}>复习全部收藏</button>
                <button onClick={startMistakeSession} disabled={!mistakeWords.length}>强化当前错词</button>
                <button onClick={startStubbornSession} disabled={!stubbornWordList.length}>顽固词专项</button>
                <button onClick={() => startLookupSession()} disabled={!lookupWords.length}>学习划词集</button>
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
              <button
                role="tab"
                aria-selected={wordbookTab === "stubborn"}
                className={wordbookTab === "stubborn" ? "active" : ""}
                onClick={() => setWordbookTab("stubborn")}
              >
                顽固词 <span>{stubbornWordList.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={wordbookTab === "lookups"}
                className={wordbookTab === "lookups" ? "active" : ""}
                onClick={() => setWordbookTab("lookups")}
              >
                划词集 <span>{lookupWords.length}</span>
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
                    <button className="quiet" onClick={() => markMistakeResolved(item.wordId)}>已掌握</button>
                  </div>
                </article>
              ))}
              {wordbookTab === "stubborn" && stubbornWordList.map((item) => (
                <article className="saved-word-card mistake-card" key={item.record.wordId}>
                  <div className="saved-word-mark">{item.record.triggerCount}</div>
                  <div className="saved-word-copy">
                    <div>
                      <h2>{item.word.word}</h2>
                      <span>{item.record.reason === "again-3" ? "30 天内忘记 ≥ 3 次" : "30 天内低评分 ≥ 5 次"}</span>
                    </div>
                    <p>{splitMeaning(item.word.meaning).meaning}</p>
                    <small>
                      当前 R {item.progress ? wordRetrievability(item.progress, new Date(clock)) : 0}%
                      {" · "}连续 3 次“认识/熟练”后自动退出
                    </small>
                  </div>
                  <div className="saved-word-actions">
                    <button onClick={() => focusSavedWord(item.word)}>专项修复</button>
                    <button
                      className={favorites.some((favorite) => favorite.wordId === item.record.wordId) ? "quiet saved" : "quiet"}
                      onClick={() => toggleFavorite(item.word)}
                    >
                      {favorites.some((favorite) => favorite.wordId === item.record.wordId) ? "已收藏" : "加入词本"}
                    </button>
                  </div>
                </article>
              ))}
              {wordbookTab === "lookups" && lookupWords.map((item) => (
                <article className="saved-word-card lookup-word-card" key={item.query.toLowerCase()}>
                  <div className="saved-word-mark">↳</div>
                  <div className="saved-word-copy">
                    <div>
                      <h2>{item.query}</h2>
                      <span>{item.phonetic || item.part}</span>
                    </div>
                    <p>{item.meaning}</p>
                    <small>
                      {item.part}
                      {item.note ? ` · ${item.note}` : ""}
                      {" · "}{item.source === "redbook"
                        ? "红宝书"
                        : item.source === "dictionary"
                          ? "ECDICT 本地辞典"
                          : "DS Flash"}
                    </small>
                  </div>
                  <div className="saved-word-actions">
                    <button onClick={() => startLookupSession([item.id])}>去学习</button>
                    <button
                      className="quiet"
                      onClick={() => setLookupWords((items) =>
                        items.filter((word) => word.query.toLowerCase() !== item.query.toLowerCase()))}
                    >
                      移除
                    </button>
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
              {wordbookTab === "stubborn" && stubbornWordList.length === 0 && (
                <div className="wordbook-empty">
                  <span>✓</span>
                  <h2>没有活跃顽固词</h2>
                  <p>连续成功 3 次或 30 天没有新的低评分会自动退出专项。</p>
                  <button onClick={() => setActiveView("learn")}>继续学习</button>
                </div>
              )}
              {wordbookTab === "lookups" && lookupWords.length === 0 && (
                <div className="wordbook-empty">
                  <span>↳</span>
                  <h2>还没有划词记录</h2>
                  <p>在学习卡正文中划选英文，点击“翻译”后会自动收进这里。</p>
                  <button onClick={() => setActiveView("learn")}>去划词</button>
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
              <div><span>今日新学</span><strong>{stats.newCount}</strong><small>当前目标 {effectiveNewGoal} / 上限 {dailyGoal}</small></div>
              <div><span>今日复习</span><strong>{stats.reviewCount}</strong><small>评分事件</small></div>
              <div><span>完成次数</span><strong>{stats.completionCount}</strong><small>{stats.coveredCount} 个不同单词</small></div>
              <div><span>平均可提取率</span><strong>{stats.retrievability}%</strong><small>FSRS 当前回忆概率</small></div>
              <button type="button" onClick={startTodaySession}>
                <span>已到期</span><strong>{stats.dueCount}</strong><small>开始今日任务 →</small>
              </button>
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
                          ? `${selectedDayNewCount} 新学 · ${selectedDayEvents.length - selectedDayNewCount} 复习 · ${selectedDayReviews.length} 个不同单词 · ${selectedWeakCount} 个薄弱`
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
                          <small>{review.kind === "new" ? "新学" : "复习"} · {ratingLabels[review.rating]}</small>
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
                  <span className={`rating-dot rating-${review.rating}`}>{review.kind === "new" ? "新学" : "复习"} · {ratingLabels[review.rating]}</span>
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
                <span>
                  <strong>积压时动态减量</strong>
                  <small>
                    {adaptiveNewWords
                      ? `${stats.dueCount} 个到期词，今天的新词目标调整为 ${effectiveNewGoal}`
                      : `已手动覆盖，固定按 ${dailyGoal} 个新词`}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={adaptiveNewWords}
                  onChange={(event) => setAdaptiveNewWords(event.target.checked)}
                />
              </label>
              <label>
                <span>
                  <strong>最低新词量</strong>
                  <small>积压再多也保留的最低数量；设为 0 可暂停新词</small>
                </span>
                <select
                  value={minimumNewWords}
                  disabled={!adaptiveNewWords}
                  onChange={(event) => setMinimumNewWords(Number(event.target.value))}
                >
                  <option value={0}>0 词</option>
                  <option value={5}>5 词</option>
                  <option value={10}>10 词</option>
                </select>
              </label>
              <label>
                <span>
                  <strong>考研日期</strong>
                  <small>
                    {examPlan
                      ? `${examPlan.phase} · 剩 ${examPlan.daysRemaining} 天 · 优先 ${examPlan.focusSection} · 建议至少 ${examPlan.requiredDailyNew} 个新词/天`
                      : "设置后按必考词、基础词、超纲词排序，并预测完成工作量"}
                  </small>
                  {examPlan && (
                    <small>
                      当前目标预计 {examPlan.projectedDays} 天学完，
                      {examPlan.onTrack ? `可预留 ${examPlan.reviewReserveDays} 天集中复习` : "按当前速度无法在复习预留期前完成"}
                    </small>
                  )}
                </span>
                <input
                  type="date"
                  value={examDate}
                  onChange={(event) => setExamDate(event.target.value)}
                  aria-label="考研日期"
                />
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
              <div className="backup-settings">
                <span>
                  <strong>本地数据备份</strong>
                  <small>
                    {automaticBackups[0]
                      ? `最近自动快照：${new Date(automaticBackups[0].createdAt).toLocaleString("zh-CN")}`
                      : "每天自动保存快照，也可导出为 JSON 文件"}
                  </small>
                </span>
                <div>
                  <button type="button" onClick={exportBackup}>导出备份</button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>导入备份</button>
                  {automaticBackups[0] && (
                    <button type="button" className="quiet" onClick={() => restoreBackup(automaticBackups[0].id)}>
                      恢复最近快照
                    </button>
                  )}
                </div>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={importBackup}
                />
              </div>
              <button className="reset-button" onClick={resetLearningRecords}>
                清空本机学习记录
              </button>
            </div>
            <div className="shortcut-panel">
              <h2>快捷键</h2>
              <div>
                <span><kbd>Space</kbd> 查看释义</span>
                <span><kbd>1–4</kbd> 评估记忆</span>
                <span><kbd>Z</kbd> 撤销最近评分</span>
                <span><kbd>/</kbd> 全局查词</span>
                <span><kbd>F</kbd> 收藏单词</span>
                <span><kbd>E</kbd> 内容补充</span>
                <span><kbd>A</kbd> AI 教练</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {selectionLookup && (
        <section
          className="selection-lookup"
          style={{ left: selectionLookup.x, top: selectionLookup.y }}
          role="dialog"
          aria-label={`划词查询：${selectionLookup.query}`}
          aria-live="polite"
        >
          <div className="selection-lookup-head">
            <span>
              划词查义
              {selectionLookup.result?.source === "redbook"
                ? " · 红宝书"
                : selectionLookup.result?.source === "dictionary"
                  ? " · ECDICT · 本地"
                : selectionLookup.cached
                  ? " · DS FLASH · 已缓存"
                  : selectionLookup.status === "idle"
                    ? " · 待查询"
                    : " · DS FLASH"}
            </span>
            <button
              type="button"
              onClick={() => {
                lookupAbortRef.current?.abort();
                setSelectionLookup(undefined);
              }}
              aria-label="关闭划词查询"
            >
              ×
            </button>
          </div>
          <div className="selection-lookup-query">
            <strong>{selectionLookup.result?.query ?? selectionLookup.query}</strong>
            {selectionLookup.result?.phonetic && <small>{selectionLookup.result.phonetic}</small>}
          </div>
          {selectionLookup.status === "idle" && (
            <button
              className="selection-lookup-action"
              type="button"
              onClick={() => translateSelection()}
            >
              <span>翻译</span>
              <small>查询后自动加入划词集</small>
            </button>
          )}
          {selectionLookup.status === "loading" && (
            <p className="selection-lookup-state">
              <i aria-hidden="true" />
              正在结合上下文判断词义…
            </p>
          )}
          {selectionLookup.status === "error" && (
            <div className="selection-lookup-error">
              <p>{selectionLookup.error}</p>
              <button type="button" onClick={() => translateSelection()}>重试</button>
            </div>
          )}
          {selectionLookup.status === "ready" && selectionLookup.result && (
            <>
              <div className="selection-lookup-meaning">
                <span>{selectionLookup.result.part}</span>
                <p>{selectionLookup.result.meaning}</p>
              </div>
              {selectionLookup.result.note && (
                <small className="selection-lookup-note">{selectionLookup.result.note}</small>
              )}
              <small className="selection-lookup-saved">已加入划词集</small>
              {selectionLookup.result.source === "dictionary" && (
                <button
                  className="selection-lookup-context"
                  type="button"
                  onClick={() => translateSelection({ forceAi: true })}
                >
                  让 DS 结合当前语境辨义
                </button>
              )}
            </>
          )}
        </section>
      )}

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

      {searchOpen && (
        <div className="search-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <section
            className="search-panel"
            role="dialog"
            aria-modal="true"
            aria-label="全局查词"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="search-head">
              <div>
                <p className="eyebrow">GLOBAL VOCABULARY SEARCH</p>
                <h2>查单词、释义或编号</h2>
              </div>
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="关闭查词">×</button>
            </div>
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSelectedSearchIds([]);
              }}
              placeholder="例如 outline、轮廓、1172"
              aria-label="搜索红宝书词库"
            />
            <div className="search-summary">
              <span>{searchQuery ? `找到 ${searchResults.length} 条结果` : "输入关键词开始搜索"}</span>
              {searchResults.length > 0 && (
                <button type="button" onClick={startSearchSession}>
                  {selectedSearchIds.length
                    ? `学习已选 ${selectedSearchIds.length} 词`
                    : `学习当前 ${searchResults.length} 词`}
                </button>
              )}
            </div>
            <div className="search-results">
              {searchResults.map((word) => {
                const progressItem = word.id === undefined ? undefined : wordProgress[word.id];
                const selected = word.id !== undefined && selectedSearchIds.includes(word.id);
                return (
                  <article key={word.id}>
                    <button
                      type="button"
                      className={selected ? "search-select selected" : "search-select"}
                      onClick={() => {
                        if (word.id === undefined) return;
                        setSelectedSearchIds((items) => items.includes(word.id!)
                          ? items.filter((wordId) => wordId !== word.id)
                          : [...items, word.id!]);
                      }}
                      aria-pressed={selected}
                      aria-label={selected ? `取消选择 ${word.word}` : `选择 ${word.word}`}
                    >
                      {selected ? "✓" : "+"}
                    </button>
                    <div>
                      <div><strong>{word.word}</strong><span>{splitMeaning(word.meaning).part}</span></div>
                      <p>{splitMeaning(word.meaning).meaning}</p>
                      <small>
                        {word.section} · Unit {word.unit}
                        {progressItem
                          ? ` · R ${wordRetrievability(progressItem, new Date(clock))}% · ${progressItem.status === "mastered" ? "已掌握" : formatDueTime(progressItem.nextDueAt, new Date(clock))}`
                          : " · 未学习"}
                      </small>
                    </div>
                    <button type="button" className="search-learn" onClick={() => {
                      startSession("search", `专项学习 · ${word.word}`, word.id === undefined ? [] : [word.id]);
                      setSearchOpen(false);
                    }}>
                      学习
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {undoVisible && ratingUndo && <button type="button" onClick={undoLastRating}>撤销</button>}
        </div>
      )}
    </main>
  );
}
