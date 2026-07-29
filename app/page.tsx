"use client";

import {
  FormEvent,
  useCallback,
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
  buildStudyKey,
  dateKey,
  learningStats,
  MAX_REVIEWS,
  splitMeaning,
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
  dueWordIds,
  formatInterval,
  isWeakProgress,
  nextInterval,
  rebuildStubbornWords,
  rebuildWordProgress,
  resolveWeakProgress,
  stubbornWordIds,
  weakWordIds,
  type StudySession,
  type StubbornWordMap,
  type WordEnrichment,
  type WordProgress,
  type WordProgressMap,
} from "../lib/learning";
import {
  buildLearningInsights,
  buildReviewForecast,
} from "../lib/insights";
import { useAiCoach } from "./hooks/useAiCoach";
import { useAudio } from "./hooks/useAudio";
import { useClock } from "./hooks/useClock";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSearch } from "./hooks/useSearch";
import { useSelectionLookup } from "./hooks/useSelectionLookup";
import { useStudyPersistence } from "./hooks/useStudyPersistence";
import { useStudySession } from "./hooks/useStudySession";
import { useSyncedRefs } from "./hooks/useSyncedRefs";
import BooksView from "./components/BooksView";
import CoachPanel from "./components/CoachPanel";
import HistoryView from "./components/HistoryView";
import RatingBar from "./components/RatingBar";
import SearchPanel from "./components/SearchPanel";
import SelectionLookupPopup from "./components/SelectionLookupPopup";
import SessionCompleteView from "./components/SessionCompleteView";
import SettingsView from "./components/SettingsView";
import WelcomeScreen from "./components/WelcomeScreen";
import WordCard from "./components/WordCard";
import WordbookView from "./components/WordbookView";
import {
  clozeSentence,
  formatRecallTime,
  maskWord,
  shuffleWithSeed,
  splitSenseItems,
} from "../lib/word-utils";
import {
  learningWordId,
  lookupIdentity,
  toLookupStudyWord,
} from "../lib/selection-lookup";
import { buildSessionCompletionSummary } from "../lib/session-summary";

type RedbookStatus = "loading" | "ready" | "error";
type ActivityRange = 140 | 182 | 365;

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
export default function Home() {
  const [started, setStarted] = useState(false);
  const [activeView, setActiveView] = useState<"learn" | "books" | "wordbook" | "history" | "settings">("learn");
  const [revealed, setRevealed] = useState(false);
  const [positions, setPositions] = useState<StudyPositions>({});
  const [reviews, setReviews] = useState<Review[]>([]);
  const [wordProgress, setWordProgress] = useState<WordProgressMap>({});
  const {
    activeSession,
    setActiveSession,
    sessionComplete,
    sessionStats: activeSessionStats,
    hydrate: hydrateSession,
    startSession: createActiveSession,
    advanceSession,
    restoreSession,
    clearSession,
    appendTodayDue,
    clearStaleToday,
  } = useStudySession();
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
  const [toast, setToast] = useState("");
  const [redbookWords, setRedbookWords] = useState<Word[]>([]);
  const [redbookStatus, setRedbookStatus] = useState<RedbookStatus>("loading");
  const [selectedSection, setSelectedSection] = useState("必考词");
  const [selectedUnit, setSelectedUnit] = useState<number | string | "all">(1);
  const [activityRange, setActivityRange] = useState<ActivityRange>(365);
  const [activityOffset, setActivityOffset] = useState(0);
  const [selectedActivityDate, setSelectedActivityDate] = useState("");
  const [learningItemCount, setLearningItemCount] = useState(REDBOOK_SOURCE_TOTAL);
  const importInputRef = useRef<HTMLInputElement>(null);
  const reinforcementInputRef = useRef<HTMLInputElement>(null);
  const wordCardRef = useRef<HTMLElement>(null);
  const previousSessionCompleteRef = useRef(sessionComplete);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const ratingUndoTimerRef = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string, duration = 3000) => {
    setToast(message);
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = undefined;
    }, duration);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current);
    }
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
    }
  }, []);

  const { clock } = useClock();
  const {
    searchOpen, searchQuery, selectedSearchIds,
    setSearchOpen, setSearchQuery, setSelectedSearchIds,
  } = useSearch();

  const lookupStudyWords = useMemo<Word[]>(
    () => lookupWords.map(toLookupStudyWord),
    [lookupWords],
  );
  const wordById = useMemo(() => new Map(
    // 红宝书词目放在后面；linkedWordId 命中时保留原书完整数据。
    [...lookupStudyWords, ...redbookWords].map((word) => [word.id, word]),
  ), [lookupStudyWords, redbookWords]);
  const wordByText = useMemo(() => {
    const exact = new Map<string, Word>();
    const folded = new Map<string, Word[]>();
    for (const word of redbookWords) {
      const text = word.word.trim();
      if (!exact.has(text)) exact.set(text, word);
      const key = text.toLowerCase();
      folded.set(key, [...(folded.get(key) ?? []), word]);
    }
    return { exact, folded };
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
  const currentBase = activeSession
    ? studyWords[Math.min(wordIndex, Math.max(0, studyWords.length - 1))]
    : studyWords[wordIndex % Math.max(1, studyWords.length)];
  const currentEnrichment = currentBase?.id === undefined
    ? undefined
    : enrichments[currentBase.id];
  const currentDictionaryPhonetic = currentBase?.id === undefined
    ? ""
    : dictionaryPhonetics[currentBase.id] ?? "";
  const current = useMemo<Word>(
    () => currentBase
      ? {
          ...currentBase,
          phonetic: currentBase.phonetic
            || currentDictionaryPhonetic
            || undefined,
          sentence: currentEnrichment?.sentence ?? currentBase.sentence,
          translation: currentEnrichment?.translation ?? currentBase.translation,
          collocation: currentEnrichment?.collocations?.join(" · ") ?? currentBase.collocation,
        }
      : REDBOOK_PLACEHOLDER,
    [currentBase, currentDictionaryPhonetic, currentEnrichment],
  );
  const {
    selectionLookup,
    handleTextSelection,
    translateSelection,
    closeSelectionLookup,
  } = useSelectionLookup({
    current,
    currentBase,
    currentDictionaryPhonetic,
    wordByText,
    lookupWords,
    setLookupWords,
    setDictionaryPhonetics,
  });
  const redbookReady = redbookStatus === "ready";
  const isFavorite = current.id !== undefined
    && favorites.some((item) => item.wordId === current.id);
  const stats = useMemo(
    () => learningStats(reviews, wordProgress, new Date(clock)),
    [clock, reviews, wordProgress],
  );
  const todayKey = dateKey(new Date(clock));
  const insights = useMemo(
    () => buildLearningInsights(reviews, new Date(clock), 7),
    [clock, reviews],
  );
  const reviewForecast = useMemo(
    () => buildReviewForecast(wordProgress, new Date(clock), 7),
    [clock, wordProgress],
  );
  const sessionCompletionSummary = useMemo(
    () => activeSession && sessionComplete
      ? buildSessionCompletionSummary({
          session: activeSession,
          reviews,
          wordProgress,
          now: new Date(clock),
        })
      : undefined,
    [activeSession, clock, reviews, sessionComplete, wordProgress],
  );
  // 展示用自动顽固词计算不进入写盘链路；按自然日更新即可。
  const stubbornWords = useMemo(
    () => ({
      ...stubbornHistory,
      ...rebuildStubbornWords(reviews, new Date(`${todayKey}T12:00:00`)),
    }),
    [reviews, stubbornHistory, todayKey],
  );
  const effectiveNewGoal = adaptiveNewWordGoal({
    dailyGoal,
    minimumNewWords,
    dueCount: stats.dueCount,
    enabled: adaptiveNewWords,
  });
  const progress = Math.min(
    100,
    Math.round((stats.newCount / Math.max(1, effectiveNewGoal)) * 100),
  );
  const currentProgress = current.id === undefined ? undefined : wordProgress[current.id];
  const ratingIntervalLabels = ([0, 1, 2, 3] as const).map((rating) =>
    formatInterval(nextInterval(currentProgress, rating, new Date(clock))));
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

  const {
    aiOpen, aiInput, aiAnswer, aiLoading, aiMode,
    enrichmentLoading,
    setAiOpen, setAiInput, setAiAnswer, setAiMode,
    submitCoach, askCoach, enrichCurrentWord,
  } = useAiCoach({
    current,
    enrichments,
    setEnrichments,
    unfamiliarMeanings,
    currentFamiliarMeanings,
    onNotify: showToast,
  });
  const { audioIndex, speak, speakNext, recordedAudioRef } = useAudio({
    current,
    studyWords,
    wordIndex,
    redbookReady,
    onNotify: showToast,
  });

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
  // 持久化快照：仅保存用户手动标记的顽固词，自动计算的顽固词在每次 load 时从 reviews 重建
  const persistedState = useMemo<StoredState>(() => ({
    schemaVersion: STORAGE_VERSION,
    reviews,
    wordProgress,
    favorites,
    mistakes,
    stubbornWords: stubbornHistory,
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
    stubbornHistory,
    studyMode,
    studyScope,
    wordProgress,
  ]);

  const {
    hydrated,
    loadStatus,
    operationInProgress,
    saveStatus,
    lastSaveTime,
    automaticBackups,
    recoveryCopies,
    retrySave,
    exportBackup,
    exportRecoveryCopy,
    importBackup,
    restoreBackup,
    restoreRecoveryCopy,
    discardRecoveryCopy,
    resetLearningRecords,
  } = useStudyPersistence({
    state: persistedState,
    todayKey,
    onApplyState: applyStoredState,
    onNotify: showToast,
  });

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
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
        const exactIdLookup = new Map(
          auditedWords.map((word) => [
            `${word.section ?? ""}:${word.unit ?? ""}:${word.word}`,
            word.id,
          ]),
        );
        const foldedIdLookup = new Map<string, number | undefined>();
        for (const word of auditedWords) {
          const key = `${word.section ?? ""}:${word.unit ?? ""}:${word.word.toLowerCase()}`;
          if (!foldedIdLookup.has(key)) foldedIdLookup.set(key, word.id);
        }
        setRedbookWords(auditedWords);
        setLearningItemCount(analysis.metadata.learningItemCount);
        setReviews((items) => {
          if (!items.some((review) => review.wordId === undefined)) {
            return items;
          }
          const mappedReviews = items.map((review) => review.wordId
            ? review
            : {
                ...review,
                wordId: exactIdLookup.get(
                  `${review.section ?? ""}:${review.unit ?? ""}:${review.word}`,
                ) ?? foldedIdLookup.get(
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
        showToast("红宝书词库读取失败，请检查本地资源");
      });
    return () => {
      active = false;
    };
  }, [hydrated, showToast]);

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
    appendTodayDue(dueWordIds(wordProgress, new Date(clock)));
  }, [appendTodayDue, clock, wordProgress]);

  useEffect(() => {
    if (hydrated) clearStaleToday(todayKey);
  }, [clearStaleToday, hydrated, todayKey]);

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
    const wasComplete = previousSessionCompleteRef.current;
    previousSessionCompleteRef.current = sessionComplete;
    if (
      !wasComplete
      || sessionComplete
      || activeView !== "learn"
      || searchOpen
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      wordCardRef.current?.focus({ preventScroll: true });
    });
  }, [activeView, searchOpen, sessionComplete]);

  useEffect(() => {
    if (revealed) return;
    queueMicrotask(() => {
      setReinforcementRating(null);
      setReinforcementInput("");
      setReinforcementFeedback("");
      setReinforcementRecallMs(null);
    });
  }, [revealed]);

  // 键盘快捷键使用的 refs（通过 useSyncedRefs 自动同步）
  const {
    started: startedRef,
    activeView: activeViewRef,
    redbookReady: redbookReadyRef,
    revealed: revealedRef,
    current: currentRef,
    enrichmentLoading: enrichmentLoadingRef,
    ratingUndo: ratingUndoRef,
    aiOpen: aiOpenRef,
    searchOpen: searchOpenRef,
    selectionLookup: selectionLookupRef,
    sessionComplete: sessionCompleteRef,
    operationInProgress: dataOperationRef,
  } = useSyncedRefs({
    started,
    activeView,
    redbookReady,
    revealed,
    current,
    enrichmentLoading,
    ratingUndo,
    aiOpen,
    searchOpen,
    selectionLookup,
    sessionComplete,
    operationInProgress,
  });

  useKeyboardShortcuts({
    paused: () =>
      dataOperationRef.current
      || aiOpenRef.current
      || searchOpenRef.current
      || selectionLookupRef.current !== undefined,
    shortcuts: [
      {
        key: "Escape",
        action: () => {
          setSearchOpen(false);
          setAiOpen(false);
          closeSelectionLookup();
        },
      },
      {
        key: "Space",
        action: () => {
          if (!startedRef.current) beginLearning();
          else if (
            activeViewRef.current === "learn"
            && redbookReadyRef.current
            && !sessionCompleteRef.current
          ) {
            setRevealed(true);
          }
        },
      },
      {
        key: "a",
        when: () => startedRef.current && !sessionCompleteRef.current,
        action: () => setAiOpen((value) => !value),
      },
      {
        key: "e",
        when: () =>
          startedRef.current
          && !sessionCompleteRef.current
          && activeViewRef.current === "learn"
          && revealedRef.current
          && redbookReadyRef.current
          && !currentRef.current.sentence
          && !enrichmentLoadingRef.current,
        action: () => enrichCurrentWord(),
      },
      {
        key: "f",
        when: () =>
          startedRef.current
          && !sessionCompleteRef.current
          && activeViewRef.current === "learn",
        action: () => toggleFavorite(),
      },
      {
        key: "z",
        when: () => !!ratingUndoRef.current,
        action: () => undoLastRating(),
      },
      {
        key: "/",
        action: () => setSearchOpen(true),
      },
      {
        key: "1",
        when: () => revealedRef.current && !sessionCompleteRef.current,
        action: () => rateWord(0),
      },
      {
        key: "2",
        when: () => revealedRef.current && !sessionCompleteRef.current,
        action: () => rateWord(1),
      },
      {
        key: "3",
        when: () => revealedRef.current && !sessionCompleteRef.current,
        action: () => rateWord(2),
      },
      {
        key: "4",
        when: () => revealedRef.current && !sessionCompleteRef.current,
        action: () => rateWord(3),
      },
    ],
  });

  function applyStoredState(state: StoredState) {
    setReviews(state.reviews);
    setWordProgress(state.wordProgress);
    setPositions(state.positions);
    hydrateSession(state);
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
  }

  function beginLearning() {
    setStarted(true);
    setRecallStartedAt(new Date().getTime());
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
      : Math.max(0, new Date().getTime() - recallStartedAt);
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
      sessionId: activeSession?.id,
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
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = undefined;
    }
    setToast(`${ratingLabels[typedRating]} · ${formatInterval(result.review.intervalMs)}后复习${recallMessage} · Z 撤销`);
    setReinforcementRating(null);
    setReinforcementInput("");
    setReinforcementFeedback("");
    setReinforcementRecallMs(null);
    setRevealed(false);
    if (activeSession) {
      advanceSession();
    } else {
      setPositions((items) => ({
        ...items,
        [studyKey]: (wordIndex + 1) % Math.max(1, studyWords.length),
      }));
    }
    setRecallStartedAt(new Date().getTime());
    setAiAnswer("我会用语境、联想和小测验帮你真正记住这个词。");
    setAiMode("unknown");
    if (soundOn && (!activeSession || wordIndex + 1 < studyWords.length)) {
      setTimeout(speakNext, 80);
    }
    const ratedReviewId = result.review.id;
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
    }
    ratingUndoTimerRef.current = window.setTimeout(() => {
      setToast((message) => message.endsWith("· Z 撤销") ? "" : message);
      setUndoVisible(false);
      setRatingUndo((undo) =>
        undo?.reviewId === ratedReviewId ? undefined : undo);
      ratingUndoTimerRef.current = undefined;
    }, 5000);
  }

  function undoLastRating() {
    if (!ratingUndo) return;
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
      ratingUndoTimerRef.current = undefined;
    }
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
      restoreSession(ratingUndo.previousSession);
    } else {
      clearSession();
      setPositions((items) => ({
        ...items,
        [ratingUndo.studyKey]: ratingUndo.previousPosition,
      }));
    }
    setActiveView("learn");
    setRevealed(true);
    setRecallStartedAt(new Date().getTime());
    setRatingUndo(undefined);
    setUndoVisible(false);
    showToast(`已撤销 ${ratingUndo.word.word} 的最近评分`, 1800);
  }

  function changeStudyMode(mode: StudyMode) {
    clearSession();
    setStudyScope("selection");
    setStudyMode(mode);
    if (mode === "shuffled") {
      const prefix = `selection:${selectedSection}:${selectedUnit}:shuffled:`;
      setPositions((items) => Object.fromEntries(
        Object.entries(items).filter(([key]) => !key.startsWith(prefix)),
      ));
      setShuffleSeed(new Date().getTime());
    }
    setRevealed(false);
    showToast(
      mode === "shuffled" ? "已打乱当前单元" : "已恢复红宝书顺序",
      1600,
    );
  }

  function startAllBookShuffle(openLearning = true) {
    clearSession();
    setPositions((items) => Object.fromEntries(
      Object.entries(items).filter(([key]) => !key.startsWith("all:shuffled:")),
    ));
    setStudyScope("all");
    setStudyMode("shuffled");
    setShuffleSeed(new Date().getTime());
    setRevealed(false);
    if (openLearning) setActiveView("learn");
    showToast(
      `已打乱 ${learningItemCount} 个学习项，保留 ${REDBOOK_SOURCE_TOTAL} 条原书来源`,
      1800,
    );
  }

  function startSession(
    kind: StudySession["kind"],
    title: string,
    wordIds: number[],
    originKind?: StudySession["originKind"],
  ) {
    if (!wordIds.length) {
      showToast("当前没有可加入学习队列的单词", 1800);
      return;
    }
    createActiveSession(kind, title, wordIds, originKind);
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
      ratingUndoTimerRef.current = undefined;
    }
    setRatingUndo(undefined);
    setUndoVisible(false);
    beginLearning();
    setRevealed(false);
    setActiveView("learn");
    showToast(`已建立${title} · ${wordIds.length} 词`, 1800);
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
      "stubborn",
      "顽固词专项",
      stubbornWordIds(stubbornWords, wordProgress),
    );
  }

  function startLookupSession(wordIds = lookupWords.map(learningWordId)) {
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

  function getSessionPrimaryAction() {
    if (!activeSession) return undefined;
    const sourceKind = activeSession.kind === "reinforcement"
      ? activeSession.originKind
      : activeSession.kind;
    if (sourceKind === "today") {
      // 该函数仅会在按钮点击后执行，规则无法跨辅助函数识别事件边界。
      // eslint-disable-next-line react-hooks/refs
      return { label: "刷新今日任务", onClick: () => startTodaySession() };
    }
    if (sourceKind === "search") {
      return {
        label: "继续搜索",
        onClick: () => {
          clearSession();
          if (ratingUndoTimerRef.current !== undefined) {
            window.clearTimeout(ratingUndoTimerRef.current);
            ratingUndoTimerRef.current = undefined;
          }
          setRatingUndo(undefined);
          setUndoVisible(false);
          setSearchOpen(true);
        },
      };
    }
    if (!sourceKind) return undefined;
    const tab = sourceKind === "favorites"
      ? "favorites"
      : sourceKind === "lookups"
        ? "lookups"
        : sourceKind === "stubborn"
          ? "stubborn"
          : "mistakes";
    return {
      label: activeSession.kind === "reinforcement" ? "返回原词本" : "返回词本",
      onClick: () => {
        clearSession();
        if (ratingUndoTimerRef.current !== undefined) {
          window.clearTimeout(ratingUndoTimerRef.current);
          ratingUndoTimerRef.current = undefined;
        }
        setRatingUndo(undefined);
        setUndoVisible(false);
        setWordbookTab(tab);
        setActiveView("wordbook");
      },
    };
  }

  function returnToFreeStudy() {
    setActiveSession(undefined);
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
      ratingUndoTimerRef.current = undefined;
    }
    setRatingUndo(undefined);
    setUndoVisible(false);
    setRevealed(false);
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
    showToast("已移出当前薄弱词，历史评分仍会保留", 1800);
  }

  function toggleFavorite(word: Word = current) {
    if ((!redbookReady && word === current) || word.id === undefined) return;
    const exists = favorites.some((item) => item.wordId === word.id);
    setFavorites((items) => exists
      ? items.filter((item) => item.wordId !== word.id)
      : [{ wordId: word.id!, addedAt: new Date().toISOString() }, ...items]);
    showToast(exists ? "已移出我的词本" : "已加入我的词本", 1600);
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

  const navigation = [
    { id: "learn", label: "学习", mark: "⌁" },
    { id: "books", label: "词书", mark: "□" },
    { id: "wordbook", label: "词本", mark: "◇" },
    { id: "history", label: "轨迹", mark: "↗" },
    { id: "settings", label: "设置", mark: "○" },
  ] as const;

  return (
    <main
      className="app-shell"
      aria-busy={operationInProgress || loadStatus === "loading"}
    >
      {!started && <WelcomeScreen onBegin={beginLearning} />}
      {(operationInProgress || loadStatus === "loading") && (
        <div
          className="data-operation-shield"
          role="status"
          aria-live="assertive"
        >
          <span>
            {operationInProgress
              ? "正在安全写入学习数据…"
              : "正在读取本地学习数据…"}
          </span>
        </div>
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
            {sessionComplete && sessionCompletionSummary && (
              <SessionCompleteView
                summary={sessionCompletionSummary}
                onReinforce={(wordIds) => {
                  const originKind = activeSession?.kind === "reinforcement"
                    ? activeSession.originKind
                    : activeSession?.kind;
                  startSession(
                    "reinforcement",
                    "本次薄弱词 · 再强化",
                    wordIds,
                    originKind,
                  );
                }}
                primaryAction={getSessionPrimaryAction()}
                onFreeStudy={returnToFreeStudy}
                onUndo={ratingUndo ? undoLastRating : undefined}
              />
            )}
            {!sessionComplete && (
              <>
            <div className="orbit-stage" style={{ "--progress": `${Math.max(progress, 4)}%` } as React.CSSProperties}>
              <div className="orbit-label orbit-label-top">NEW · {currentLocation}</div>
              <WordCard
                wordCardRef={wordCardRef}
                reinforcementInputRef={reinforcementInputRef}
                revealed={revealed}
                reinforcementRating={reinforcementRating}
                redbookReady={redbookReady}
                redbookStatus={redbookStatus}
                current={current}
                currentSenses={currentSenses}
                currentFamiliarMeanings={currentFamiliarMeanings}
                currentEnrichment={currentEnrichment}
                currentProgress={currentProgress}
                isFavorite={isFavorite}
                audioIndex={audioIndex}
                activeSession={activeSession}
                newCount={stats.newCount}
                currentLocation={currentLocation}
                clock={clock}
                reinforcementInput={reinforcementInput}
                reinforcementFeedback={reinforcementFeedback}
                reinforcementSentence={reinforcementSentence}
                reinforcementMeaning={reinforcementMeaning}
                enrichmentLoading={enrichmentLoading}
                unfamiliarMeanings={unfamiliarMeanings}
                onReveal={() => setRevealed(true)}
                onToggleFavorite={() => toggleFavorite()}
                onSpeak={speak}
                onToggleMeaningFamiliar={toggleMeaningFamiliar}
                onEnrichWord={enrichCurrentWord}
                onTextSelection={handleTextSelection}
                onSetReinforcementInput={setReinforcementInput}
                onClearReinforcementFeedback={() => setReinforcementFeedback("")}
                onSubmitReinforcement={submitReinforcement}
                onSkipReinforcement={skipReinforcement}
              />
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

            <RatingBar
              visible={revealed && redbookReady && reinforcementRating === null}
              ratingLabels={ratingLabels}
              ratingIntervalLabels={ratingIntervalLabels}
              onRate={(rating) => rateWord(rating)}
            />
              </>
            )}
          </div>
        )}

        {activeView === "books" && (
          <BooksView
            sectionMeta={SECTION_META}
            redbookWords={redbookWords}
            wordProgress={wordProgress}
            learningItemCount={learningItemCount}
            clock={clock}
            onSelectBook={(section, unit) => {
              setSelectedSection(section);
              setSelectedUnit(unit);
              setStudyScope("selection");
              setActiveSession(undefined);
              setRevealed(false);
              setActiveView("learn");
            }}
            onAllShuffle={() => startAllBookShuffle()}
          />
        )}

        {activeView === "wordbook" && (
          <WordbookView
            activeTab={wordbookTab}
            favoriteWords={favoriteWords}
            mistakeWords={mistakeWords}
            stubbornWordList={stubbornWordList}
            lookupWords={lookupWords}
            ratingLabels={ratingLabels}
            clock={clock}
            favorites={favorites}
            onTabChange={setWordbookTab}
            onFocusWord={focusSavedWord}
            onToggleFavorite={toggleFavorite}
            onResolveMistake={markMistakeResolved}
            onStartFavorites={startFavoriteSession}
            onStartMistakes={startMistakeSession}
            onStartStubborn={startStubbornSession}
            onStartLookups={startLookupSession}
            onRemoveLookup={(item) => {
              const identity = lookupIdentity(item);
              setLookupWords((items) =>
                items.filter((word) => lookupIdentity(word) !== identity));
            }}
            onNavigateLearn={() => setActiveView("learn")}
          />
        )}

        {activeView === "history" && (
          <HistoryView
            stats={stats}
            effectiveNewGoal={effectiveNewGoal}
            dailyGoal={dailyGoal}
            reviews={reviews}
            clock={clock}
            activityRange={activityRange}
            activityOffset={activityOffset}
            activityRangeLabels={activityRangeLabels}
            selectedActivityDate={selectedActivityDate}
            ratingLabels={ratingLabels}
            insights={insights}
            reviewForecast={reviewForecast}
            onStartTodaySession={startTodaySession}
            onActivityRangeChange={(range) => {
              setActivityRange(range);
              setActivityOffset(0);
              setSelectedActivityDate("");
            }}
            onActivityNavigate={(direction) => {
              setActivityOffset((offset) =>
                Math.max(0, offset + direction * activityRange));
              setSelectedActivityDate("");
            }}
            onActivityToday={() => {
              setActivityOffset(0);
              setSelectedActivityDate("");
            }}
            onSelectDate={setSelectedActivityDate}
          />
        )}

        {activeView === "settings" && (
          <SettingsView
            dataActionsDisabled={
              loadStatus === "loading" || operationInProgress
            }
            dataReplacementDisabled={
              loadStatus !== "ready"
              || saveStatus === "error"
              || operationInProgress
            }
            dataActionsLoading={
              loadStatus === "loading"
                ? "hydrating"
                : operationInProgress
                  ? "authoritative"
                  : null
            }
            dailyGoal={dailyGoal}
            adaptiveNewWords={adaptiveNewWords}
            minimumNewWords={minimumNewWords}
            examDate={examDate}
            examPlan={examPlan}
            soundOn={soundOn}
            studyMode={studyMode}
            studyScope={studyScope}
            learningItemCount={learningItemCount}
            aiMode={aiMode}
            automaticBackups={automaticBackups}
            stats={stats}
            effectiveNewGoal={effectiveNewGoal}
            saveStatus={saveStatus}
            lastSaveTime={lastSaveTime}
            recoveryCopies={recoveryCopies.map((copy) => ({
              id: copy.id,
              createdAt: copy.createdAt,
              restorable: copy.state !== undefined,
            }))}
            onDailyGoalChange={setDailyGoal}
            onAdaptiveChange={setAdaptiveNewWords}
            onMinWordsChange={setMinimumNewWords}
            onExamDateChange={setExamDate}
            onSoundChange={setSoundOn}
            onModeChange={(mode) => {
              if (mode === "all") startAllBookShuffle(false);
              else changeStudyMode(mode);
            }}
            onExportBackup={exportBackup}
            onImportClick={() => importInputRef.current?.click()}
            onImportBackup={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importBackup(file);
            }}
            onRestoreBackup={restoreBackup}
            onRetrySave={retrySave}
            onExportRecovery={exportRecoveryCopy}
            onRestoreRecovery={restoreRecoveryCopy}
            onDiscardRecovery={discardRecoveryCopy}
            onResetRecords={resetLearningRecords}
            importInputRef={importInputRef}
          />
        )}
      </section>

      {selectionLookup && (
        <SelectionLookupPopup
          lookup={selectionLookup}
          onTranslate={translateSelection}
          onClose={closeSelectionLookup}
        />
      )}

      <CoachPanel
        open={aiOpen}
        word={current.word}
        meaning={currentMeaning.meaning}
        aiMode={aiMode}
        aiAnswer={aiAnswer}
        aiLoading={aiLoading}
        aiInput={aiInput}
        onInputChange={setAiInput}
        onAsk={askCoach}
        onSubmit={submitCoach}
        onClose={() => setAiOpen(false)}
      />

      {searchOpen && (
        <SearchPanel
          open={searchOpen}
          query={searchQuery}
          results={searchResults}
          selectedIds={selectedSearchIds}
          wordProgress={wordProgress}
          clock={clock}
          onQueryChange={(value) => {
            setSearchQuery(value);
            setSelectedSearchIds([]);
          }}
          onToggleSelect={(wordId) => {
            setSelectedSearchIds((items) => items.includes(wordId)
              ? items.filter((item) => item !== wordId)
              : [...items, wordId]);
          }}
          onStartSearch={startSearchSession}
          onStartWordSession={(wordIds) => {
            const word = wordIds[0] === undefined ? undefined : wordById.get(wordIds[0]);
            startSession("search", `专项学习${word ? ` · ${word.word}` : ""}`, wordIds);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {(toast || (undoVisible && ratingUndo)) && (
        <div className="toast" role="status">
          {toast && <span>{toast}</span>}
          {undoVisible && ratingUndo && <button type="button" onClick={undoLastRating}>撤销</button>}
        </div>
      )}
    </main>
  );
}
