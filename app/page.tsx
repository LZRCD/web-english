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
  buildRedbookLoadGuidance,
  isPrimaryLearningWord,
  REDBOOK_SOURCE_TOTAL,
  type RedbookLoadGuidance,
} from "../lib/redbook";
import {
  buildStudyKey,
  dateKey,
  learningStats,
  splitMeaning,
  STORAGE_VERSION,
  type FamiliarMeaningMap,
  type GuessMistakeMap,
  type LookupStats,
  type LookupWord,
  type MistakeRecord,
  type RatingUndo,
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
  buildStudyWordSource,
  buildTodayTaskPreview,
  examProgressTiers,
  dueWordIds,
  formatInterval,
  isWeakProgress,
  nextInterval,
  rebuildStubbornWords,
  rebuildWordProgress,
  resolveWeakProgress,
  stubbornWordIds,
  weakWordIds,
  type SenseFrequencyMap,
  type StudySession,
  type StubbornWordMap,
  type WordEnrichment,
  type WordProgressMap,
} from "../lib/learning";
import {
  buildLearningInsights,
  buildReviewForecast,
  buildWeeklyLearningReport,
} from "../lib/insights";
import {
  buildSprintCsv,
  buildDimensionObservationReport,
  buildSprintEffectivenessSeries,
  buildWeakCandidateSummary,
  buildSprintHistory,
  buildSprintRecordWordIds,
  buildSprintRelapseSeries,
  buildSprintRetentionSeries,
  buildSprintSummary,
  buildSprintTreatmentRecommendation,
  buildStubbornTreatmentRecommendation,
  buildSprintWordIds,
  buildScopedSprintWordIds,
  buildWeakConcentration,
  buildWeakDimensionTrendSeries,
  buildWordStabilizedDimensions,
  buildWordSignalTimeline,
  buildWeakProfiles,
  buildWordWeakSignals,
  DEFAULT_WEAK_THRESHOLDS,
  lookupPriorityWordIds,
  lookupStatForWordId,
  lookupWeakCandidateIds,
  createTreatmentSprintSessionId,
  createStubbornSprintSessionId,
  parseStubbornSprintSessionId,
  type WeakSignalInput,
  type SprintTreatmentRecommendation,
  type StabilizedDimension,
  type WeakThresholds,
  type WordRecallStats,
} from "../lib/weak-signals";
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
  buildSentenceIndex,
  reusedSentencesFor,
  type ReusedSentence,
} from "../lib/sentence-index";
import {
  learningWordId,
  lookupIdentity,
  toLookupStudyWord,
} from "../lib/selection-lookup";
import {
  buildSessionCompletionSummary,
  buildSprintCompletionSummary,
  mergeSprintWithTrend,
} from "../lib/session-summary";
import {
  createPerformanceTrace,
  fetchJsonWithDiagnostics,
  startPerformanceTimer,
} from "../lib/performance-diagnostics";
import { versionedDataUrl } from "../lib/data-version";
import type { QuizQuestion, QuizAttempt, QuizSessionState } from "../lib/quiz";
import {
  appendQuizAttempt,
  createQuizSession,
  shouldApplyQuizToSchedule,
} from "../lib/quiz";
import QuizView from "./components/QuizView";
import {
  ACTIVITY_RANGE_LABELS as activityRangeLabels,
  RATING_LABELS as ratingLabels,
  REDBOOK_PLACEHOLDER,
  SECTION_META,
  SECTION_PRIORITY as sectionPriority,
  type ActivityRange,
  type RedbookAnalysisData,
  type RedbookData,
  type RedbookStatus,
  type ReinforcementRating,
} from "./constants";

export default function Home() {
  const [started, setStarted] = useState(false);
  // 移动端判断：手机端 AI 面板打开时隔离底层焦点
  const [isMobile, setIsMobile] = useState(false);
  const [activeView, setActiveView] = useState<"learn" | "books" | "wordbook" | "quiz" | "history" | "settings">("learn");
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
  const [undoStack, setUndoStack] = useState<RatingUndo[]>([]);
  const [undoVisible, setUndoVisible] = useState(false);
  const [favorites, setFavorites] = useState<SavedWord[]>([]);
  const [mistakes, setMistakes] = useState<MistakeRecord[]>([]);
  const [lookupWords, setLookupWords] = useState<LookupWord[]>([]);
  const [familiarMeanings, setFamiliarMeanings] = useState<FamiliarMeaningMap>({});
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<QuizSessionState | undefined>(undefined);
  const [stubbornHistory, setStubbornHistory] = useState<StubbornWordMap>({});
  const [studyMode, setStudyMode] = useState<StudyMode>("ordered");
  const [studyScope, setStudyScope] = useState<StudyScope>("selection");
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [wordbookTab, setWordbookTab] = useState<"favorites" | "mistakes" | "stubborn" | "lookups">("favorites");
  const [pendingWordId, setPendingWordId] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [hideChineseMeaning, setHideChineseMeaning] = useState(false);
  const [guessContextFirst, setGuessContextFirst] = useState(false);
  const [lookupStats, setLookupStats] = useState<LookupStats>({});
  const [guessMistakes, setGuessMistakes] = useState<GuessMistakeMap>({});
  const [weakThresholds, setWeakThresholds] = useState<WeakThresholds>(
    DEFAULT_WEAK_THRESHOLDS,
  );
  const [senseFrequency, setSenseFrequency] = useState<SenseFrequencyMap>({});
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
  const [redbookLoadAttempt, setRedbookLoadAttempt] = useState(0);
  const [redbookLoadGuidance, setRedbookLoadGuidance] = useState<RedbookLoadGuidance>();
  const [selectedSection, setSelectedSection] = useState("必考词");
  const [selectedUnit, setSelectedUnit] = useState<number | string | "all">(1);
  const [activityRange, setActivityRange] = useState<ActivityRange>(140);
  const [activityOffset, setActivityOffset] = useState(0);
  const [selectedActivityDate, setSelectedActivityDate] = useState("");
  const [learningItemCount, setLearningItemCount] = useState(REDBOOK_SOURCE_TOTAL);
  const importInputRef = useRef<HTMLInputElement>(null);
  const reinforcementInputRef = useRef<HTMLInputElement>(null);
  const wordCardRef = useRef<HTMLElement>(null);
  const previousSessionCompleteRef = useRef(sessionComplete);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const ratingUndoTimerRef = useRef<number | undefined>(undefined);
  const [startupTraceId] = useState(() => createPerformanceTrace("startup"));
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

  const { clock, refreshClock } = useClock();
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
    setLookupStats,
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
  // 薄弱画像信号源：全部来自现有 state，派生计算、不新增 schema
  const weakSignalInput = useMemo<WeakSignalInput>(() => ({
    lookupStats,
    lookupWords,
    guessMistakes,
    quizAttempts,
    reviews,
    stubbornWords,
    wordProgress,
  }), [
    guessMistakes,
    lookupStats,
    lookupWords,
    quizAttempts,
    reviews,
    stubbornWords,
    wordProgress,
  ]);
  const weakProfiles = useMemo(
    () => buildWeakProfiles(weakSignalInput, weakThresholds),
    [weakSignalInput, weakThresholds],
  );
  // 词本展示只需要标签数组
  const weakSignalsByWordId = useMemo(
    () => Object.fromEntries(
      Object.entries(weakProfiles).map(([wordId, profile]) => [
        Number(wordId),
        profile.signals,
      ]),
    ) as Record<number, string[]>,
    [weakProfiles],
  );
  // 词级回忆耗时：有合法样本的词展示平均耗时
  const weakRecallByWordId = useMemo(
    () => Object.fromEntries(
      Object.entries(weakProfiles).flatMap(([wordId, profile]) =>
        profile.recall ? [[Number(wordId), profile.recall]] : []),
    ) as Record<number, WordRecallStats>,
    [weakProfiles],
  );
  // 划词薄弱候选：查询达到阈值的词（词本标注/过滤 + 设置页预览）
  const weakLookupCandidateIds = useMemo(
    () => lookupWeakCandidateIds(weakSignalInput, weakThresholds),
    [weakSignalInput, weakThresholds],
  );
  // 候选词名（设置页 tooltip 明细，词库缺失跳过）
  const weakLookupCandidateWords = useMemo(
    () => weakLookupCandidateIds
      .map((wordId) => wordById.get(wordId)?.word)
      .filter((word): word is string => Boolean(word)),
    [weakLookupCandidateIds, wordById],
  );
  // 划词补漏：查询达到阈值且未被近期答对覆盖的词插队今日任务
  const lookupPriorityIds = useMemo(
    () => lookupPriorityWordIds(weakSignalInput, weakThresholds),
    [weakSignalInput, weakThresholds],
  );
  const currentLookupStat = useMemo(
    () => current.id === undefined
      ? undefined
      : lookupStatForWordId(current.id, weakSignalInput),
    [current.id, weakSignalInput],
  );
  // 学习卡「已稳定」正向反馈：历史弱点满足各自恢复条件，且当前画像已清零
  const currentStabilizedDimensions = useMemo<StabilizedDimension[]>(
    () => current.id === undefined
      ? []
      : buildWordStabilizedDimensions(current.id, weakSignalInput, weakThresholds),
    [current.id, weakSignalInput, weakThresholds],
  );
  // 薄弱维度近 4 周趋势（轨迹页周报下方）
  const weakTrendSeries = useMemo(
    () => buildWeakDimensionTrendSeries(
      weakSignalInput,
      new Date(`${todayKey}T12:00:00`),
      4,
      weakThresholds,
    ),
    [todayKey, weakSignalInput, weakThresholds],
  );
  // 冲刺会话专属总结：薄弱维度分布、回忆对比、当场达标/仍需关注
  const sprintCompletionSummary = useMemo(
    () => activeSession?.kind === "sprint" && sessionComplete
      ? buildSprintCompletionSummary({
          session: activeSession,
          reviews,
          weakSignals: weakSignalInput,
          weakThresholds,
        })
      : undefined,
    [activeSession, reviews, sessionComplete, weakSignalInput, weakThresholds],
  );
  // 考前薄弱冲刺：已学且命中任一薄弱信号的词
  const sprintWordIds = useMemo(
    () => buildSprintWordIds(weakSignalInput, weakThresholds),
    [weakSignalInput, weakThresholds],
  );
  const sprintWordById = useMemo(() => {
    const map = new Map<number, Word>();
    for (const [id, word] of wordById) {
      if (id !== undefined) map.set(id, word);
    }
    return map;
  }, [wordById]);
  const sprintSummary = useMemo(
    () => buildSprintSummary(weakSignalInput, sprintWordById, weakThresholds),
    [sprintWordById, weakSignalInput, weakThresholds],
  );
  const weakConcentration = useMemo(
    () => buildWeakConcentration(weakSignalInput, wordById, weakThresholds),
    [weakSignalInput, wordById, weakThresholds],
  );
  const sprintEffectivenessSeries = useMemo(
    () => buildSprintEffectivenessSeries(reviews, new Date(clock)),
    [reviews, clock],
  );
  const sprintRelapseSeries = useMemo(
    () => buildSprintRelapseSeries(
      reviews,
      weakSignalInput,
      new Date(clock),
      4,
      weakThresholds,
    ),
    [reviews, weakSignalInput, clock, weakThresholds],
  );
  const sprintRetentionSeries = useMemo(
    () => buildSprintRetentionSeries(reviews, new Date(clock)),
    [reviews, clock],
  );
  const dimensionObservationReport = useMemo(
    () => buildDimensionObservationReport(
      reviews,
      weakSignalInput,
      new Date(clock),
      4,
      weakThresholds,
    ),
    [reviews, weakSignalInput, clock, weakThresholds],
  );
  const sprintTreatment = useMemo(
    () => buildSprintTreatmentRecommendation(weakSignalInput, weakThresholds),
    [weakSignalInput, weakThresholds],
  );
  const stubbornTreatment = useMemo(
    () => buildStubbornTreatmentRecommendation(weakSignalInput),
    [weakSignalInput],
  );
  const activeQuizCandidateWordIds = useMemo(() => {
    if (!activeQuiz?.id.startsWith("sprint:")) return undefined;
    const stubbornSession = parseStubbornSprintSessionId(activeQuiz.id);
    if (!stubbornSession) return sprintTreatment?.wordIds;
    const restoredTreatment = buildStubbornTreatmentRecommendation(
      weakSignalInput,
      new Date(stubbornSession.startedAt),
    );
    return restoredTreatment?.mode === activeQuiz.mode
      ? restoredTreatment.wordIds
      : undefined;
  }, [activeQuiz, sprintTreatment, weakSignalInput]);
  // 序列最后一项就是上个完整周，继续供当前仍薄弱词列表与再冲刺入口使用。
  const sprintRelapse = sprintRelapseSeries.at(-1)?.relapse ?? null;
  const sprintRelapseWords = useMemo(
    () => (sprintRelapse?.relapsedIds ?? []).flatMap((wordId) => {
      const word = wordById.get(wordId)?.word;
      return word ? [{ wordId, word }] : [];
    }),
    [sprintRelapse, wordById],
  );
  const sectionUnitTotals = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();
    for (const [id, word] of wordById) {
      if (id === undefined || !word.section) continue;
      const unitKey = word.unit === undefined ? "未分单元" : String(word.unit);
      const sectionUnits = totals.get(word.section) ?? new Map<string, number>();
      sectionUnits.set(unitKey, (sectionUnits.get(unitKey) ?? 0) + 1);
      totals.set(word.section, sectionUnits);
    }
    return totals;
  }, [wordById]);
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
  const currentWordSource = useMemo(
    () => buildStudyWordSource({
      session: activeSession,
      progress: currentProgress,
      lookupPriority: current.id !== undefined && lookupPriorityIds.includes(current.id),
      now: new Date(clock),
    }),
    [activeSession, clock, current.id, currentProgress, lookupPriorityIds],
  );
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
  const todayTaskPreview = useMemo(
    () => buildTodayTaskPreview({
      primaryWordIds,
      progress: wordProgress,
      configuredNewGoal: dailyGoal,
      effectiveNewGoal,
      learnedTodayCount: stats.newCount,
      adaptiveEnabled: adaptiveNewWords,
      now: new Date(clock),
      options: {
        familyKeyByWordId,
        reviewedTodayWordIds,
        lookupPriorityIds,
      },
    }),
    [
      adaptiveNewWords,
      clock,
      dailyGoal,
      effectiveNewGoal,
      familyKeyByWordId,
      lookupPriorityIds,
      primaryWordIds,
      reviewedTodayWordIds,
      stats.newCount,
      wordProgress,
    ],
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
  const examProgress = useMemo(
    () => examProgressTiers(wordProgress, examDate),
    [examDate, wordProgress],
  );

  const examPlan = useMemo(
    () => buildExamPlan({
      examDate,
      remainingBySection,
      dailyNewGoal: dailyGoal,
      now: new Date(`${todayKey}T12:00:00`),
    }),
    [dailyGoal, examDate, remainingBySection, todayKey],
  );
  const weeklyReport = useMemo(
    () => buildWeeklyLearningReport({
      reviews,
      progress: wordProgress,
      stubbornWords,
      now: new Date(`${todayKey}T12:00:00`),
      examPlan,
      dailyNewGoal: effectiveNewGoal,
      weakSignals: weakSignalInput,
      weakThresholds,
    }),
    [effectiveNewGoal, examPlan, reviews, stubbornWords, todayKey, weakSignalInput, weakThresholds, wordProgress],
  );
  // 冲刺历史：按 sessionId 分组派生，供轨迹页展示
  const sprintHistory = useMemo(
    () => buildSprintHistory(reviews),
    [reviews],
  );
  // 冲刺维度 × 周报趋势联动：清零标记 + 本周对照
  const sprintDimensionTrend = useMemo(
    () => sprintCompletionSummary && weeklyReport
      ? mergeSprintWithTrend(
          sprintCompletionSummary.dimensionCounts,
          weeklyReport.weakTrend,
        )
      : undefined,
    [sprintCompletionSummary, weeklyReport],
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
  // 跨词例句复用索引：从已缓存释义例句反向匹配包含当前词的句子
  const sentenceIndex = useMemo(
    () => buildSentenceIndex({ redbookWords, enrichments }),
    [enrichments, redbookWords],
  );
  const currentReusedSentences: ReusedSentence[] = useMemo(
    () => reusedSentencesFor(sentenceIndex, current.word, {
      lookupStats,
      lookupWords,
      wordProgress,
    }),
    [current.word, lookupStats, lookupWords, sentenceIndex, wordProgress],
  );

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
  // 强化填空例句优先级：含当前词的已见例句 → 当前词释义例句 → 红宝书原句
  const reinforcementBaseSentence =
    currentReusedSentences[0]?.sentence
    ?? currentEnrichment?.senseExamples?.find(
      (example) => unfamiliarMeanings.includes(example.meaning),
    )?.sentence
    ?? currentEnrichment?.senseExamples?.[0]?.sentence
    ?? current.sentence;
  const reinforcementSentence = reinforcementBaseSentence
    ? clozeSentence(reinforcementBaseSentence, current.word)
    : "";
  const reinforcementMeaning = unfamiliarMeanings[0]
    ?? currentMeaningItems[0]
    ?? currentMeaning.meaning;

  const {
    aiOpen, aiInput, aiAnswer, aiLoading, aiMode,
    enrichmentLoading,
    reviewingSense, rewritingSense,
    frequencyLoading, generateSenseFrequency,
    setAiOpen, setAiInput, setAiAnswer, setAiMode,
    submitCoach, askCoach, enrichCurrentWord,
    reportSenseMismatch, rewriteSenseExample,
  } = useAiCoach({
    current,
    enrichments,
    setEnrichments,
    setSenseFrequency,
    unfamiliarMeanings,
    currentFamiliarMeanings,
    onNotify: showToast,
  });

  // 监听视口宽度：手机端 AI 面板打开时隔离底层焦点
  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const { hasRecordedAudio, speak, speakNext, speakWord } = useAudio({
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
    hideChineseMeaning,
    guessContextFirst,
    weakThresholds,
    lookupStats,
    guessMistakes,
    senseFrequency,
    studyMode,
    studyScope,
    shuffleSeed,
    selectedSection,
    selectedUnit,
    ratingUndoStack: undoStack,
    quizAttempts,
    activeQuiz,
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
    hideChineseMeaning,
    guessContextFirst,
    weakThresholds,
    lookupStats,
    guessMistakes,
    senseFrequency,
    started,
    stubbornHistory,
    studyMode,
    studyScope,
    undoStack,
    quizAttempts,
    activeQuiz,
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
    startupTraceId,
    onApplyState: applyStoredState,
    onNotify: showToast,
  });

  useEffect(() => {
    let active = true;
    let renderFrame: number | undefined;
    const controller = new AbortController();
    const traceId = redbookLoadAttempt === 0
      ? startupTraceId
      : createPerformanceTrace("redbook-retry");
    const loadTimer = startPerformanceTimer("redbook.load.total", { traceId });
    Promise.all([
      fetchJsonWithDiagnostics<RedbookData>(
        versionedDataUrl("/data/redbook.json"),
        "redbook.data",
        { signal: controller.signal },
        { traceId },
      ),
      fetchJsonWithDiagnostics<RedbookAnalysisData>(
        versionedDataUrl("/data/redbook-analysis.json"),
        "redbook.analysis",
        { signal: controller.signal },
        { traceId },
      ),
    ])
      .then(([dataResult, analysisResult]) => {
        if (!active) return;
        const data = dataResult.data;
        const analysis = analysisResult.data;
        if (!data.words.length) throw new Error("redbook data empty");
        if (analysis.metadata.auditedEntries !== REDBOOK_SOURCE_TOTAL) {
          throw new Error("redbook analysis incomplete");
        }
        const indexTimer = startPerformanceTimer("redbook.load.index", {
          traceId,
          wordCount: data.words.length,
        });
        const auditedWords = data.words.map((word) => {
          const audit = word.id === undefined ? undefined : analysis.entries[String(word.id)];
          return {
            ...word,
            word: audit?.correctedWord ?? word.word,
            relation: audit?.relation,
          };
        });
        indexTimer.end();
        setRedbookWords(auditedWords);
        setRedbookLoadGuidance(undefined);
        setLearningItemCount(analysis.metadata.learningItemCount);
        setReviews((items) => {
          if (!items.some((review) => review.wordId === undefined)) {
            return items;
          }
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
        renderFrame = window.requestAnimationFrame(() => {
          loadTimer.end({
            wordCount: auditedWords.length,
            dataCacheHit: dataResult.cacheHit,
            analysisCacheHit: analysisResult.cacheHit,
          });
        });
      })
      .catch((error) => {
        loadTimer.end(
          {},
          error instanceof DOMException && error.name === "AbortError"
            ? "aborted"
            : "error",
        );
        if (!active) return;
        const guidance = buildRedbookLoadGuidance(error);
        setRedbookStatus("error");
        setRedbookLoadGuidance(guidance);
        showToast(guidance.title);
      });
    return () => {
      active = false;
      controller.abort();
      if (renderFrame !== undefined) window.cancelAnimationFrame(renderFrame);
      loadTimer.end({}, "aborted");
    };
  }, [redbookLoadAttempt, showToast, startupTraceId]);

  function retryRedbookLoad() {
    if (redbookStatus !== "error") return;
    setRedbookStatus("loading");
    setRedbookLoadGuidance(undefined);
    setRedbookLoadAttempt((attempt) => attempt + 1);
  }

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
    undoStack: undoStackRef,
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
    undoStack,
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
          if (!startedRef.current) beginFromWelcome();
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
        when: () => undoStackRef.current.length > 0,
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
    setHideChineseMeaning(state.hideChineseMeaning);
    setGuessContextFirst(state.guessContextFirst);
    setWeakThresholds(state.weakThresholds ?? DEFAULT_WEAK_THRESHOLDS);
    setLookupStats(state.lookupStats);
    setGuessMistakes(state.guessMistakes);
    setSenseFrequency(state.senseFrequency);
    setFavorites(state.favorites);
    setMistakes(state.mistakes);
    setStubbornHistory(state.stubbornWords);
    setQuizAttempts(state.quizAttempts);
    setActiveQuiz(state.activeQuiz);
    setStudyMode(state.studyMode);
    setStudyScope(state.studyScope);
    setShuffleSeed(state.shuffleSeed);
    setSelectedSection(state.selectedSection);
    setSelectedUnit(state.selectedUnit);
    setUndoStack(state.ratingUndoStack);
    setUndoVisible(false);
    refreshClock();
  }

  function beginLearning() {
    setStarted(true);
    setRecallStartedAt(new Date().getTime());
  }

  function beginFromWelcome() {
    // 默认主入口 = 今日任务；无可用队列时退回自由学习（额外练习）
    if (redbookReadyRef.current && startTodaySession()) return;
    beginLearning();
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
    setUndoStack((stack) => [...stack, {
      reviewId: result.review.id,
      wordId: current.id!,
      word: current.word,
      ...(previousProgress ? { previousProgress } : {}),
      ...(previousMistake ? { previousMistake } : {}),
      previousPosition: wordIndex,
      ...(activeSession
        ? { previousSession: { ...activeSession, wordIds: [...activeSession.wordIds] } }
        : {}),
      studyKey,
      selectedSection,
      selectedUnit,
      studyMode,
      studyScope,
      shuffleSeed,
    }].slice(-30));
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
    setReviews((items) => [...items, result.review]);
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
    refreshClock();
    if (soundOn && (!activeSession || wordIndex + 1 < studyWords.length)) {
      setTimeout(speakNext, 80);
    }
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
    }
    // 提示条 5 秒后隐藏，但撤销栈保留，随时可按 Z 或撤销按钮撤回
    ratingUndoTimerRef.current = window.setTimeout(() => {
      setToast((message) => message.endsWith("· Z 撤销") ? "" : message);
      setUndoVisible(false);
      ratingUndoTimerRef.current = undefined;
    }, 5000);
  }

  function recordQuizResult(
    question: QuizQuestion,
    correct: boolean,
    recallMs: number,
    sessionId?: string,
  ) {
    const word = question.word;
    if (!redbookReady || word.id === undefined) return;
    const now = new Date();
    const nowIso = now.toISOString();
    // 仅「每日首次有效作答」或「到期词首次作答」写入 FSRS，
    // 避免反复「再来一组」不断改写同一批词的排程。
    const applyToSchedule = shouldApplyQuizToSchedule(
      quizAttempts,
      word.id,
      now,
    );
    const attempt: QuizAttempt = {
      id: `quiz:${question.mode}:${word.id}:${nowIso}`,
      wordId: word.id,
      mode: question.mode,
      correct,
      recallMs,
      answeredAt: nowIso,
      appliedToSchedule: applyToSchedule,
    };
    setQuizAttempts((items) => appendQuizAttempt(items, attempt));
    refreshClock();

    if (!correct) {
      // 错词始终进入薄弱词队列（独立于 FSRS 排程）
      setMistakes((items) => {
        const previous = items.find((item) => item.wordId === word.id);
        const record: MistakeRecord = {
          wordId: word.id!,
          addedAt: previous?.addedAt ?? nowIso,
          mistakeCount: (previous?.mistakeCount ?? 0) + 1,
          lastRating: 0,
          lastMistakeAt: nowIso,
        };
        return [record, ...items.filter((item) => item.wordId !== word.id)];
      });
    }

    if (!applyToSchedule) {
      showToast(
        correct ? "测验正确（今日已记录，不重复改写复习计划）" : "测验答错 · 已加入薄弱词",
        1800,
      );
      return;
    }

    const rating = correct ? 2 : 0;
    const previousProgress = wordProgress[word.id];
    const result = applyRating(previousProgress, {
      wordId: word.id,
      word: word.word,
      rating,
      reviewedAt: nowIso,
      recallMs,
      section: word.section,
      unit: word.unit,
      sessionId: sessionId?.startsWith("sprint:")
        ? sessionId
        : `quiz:${question.mode}:${dateKey(nowIso)}`,
    });
    setWordProgress((items) => ({ ...items, [word.id!]: result.progress }));
    if (correct && !isWeakProgress(result.progress)) {
      setMistakes((items) => items.filter((item) => item.wordId !== word.id));
    }
    setReviews((items) => [...items, result.review]);
    showToast(
      correct
        ? `专项测验正确 · ${formatInterval(result.review.intervalMs)}后复习`
        : `专项测验答错 · 已加入薄弱词，${formatInterval(result.review.intervalMs)}后复习`,
      2200,
    );
  }

  function undoLastRating() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
      ratingUndoTimerRef.current = undefined;
    }
    window.speechSynthesis?.cancel();
    setReviews((items) => {
      const rest = items.filter((review) => review.id !== entry.reviewId);
      return rest;
    });
    setWordProgress((items) => {
      const next = { ...items };
      if (entry.previousProgress) {
        next[entry.wordId] = entry.previousProgress;
      } else {
        delete next[entry.wordId];
      }
      return next;
    });
    setMistakes((items) => {
      const rest = items.filter((item) => item.wordId !== entry.wordId);
      return entry.previousMistake
        ? [entry.previousMistake, ...rest]
        : rest;
    });
    setSelectedSection(entry.selectedSection);
    setSelectedUnit(entry.selectedUnit);
    setStudyMode(entry.studyMode);
    setStudyScope(entry.studyScope);
    setShuffleSeed(entry.shuffleSeed);
    if (entry.previousSession) {
      restoreSession(entry.previousSession);
    } else {
      clearSession();
      setPositions((items) => ({
        ...items,
        [entry.studyKey]: entry.previousPosition,
      }));
    }
    setActiveView("learn");
    setRevealed(true);
    setRecallStartedAt(new Date().getTime());
    setUndoStack((stack) => stack.slice(0, -1));
    setUndoVisible(false);
    refreshClock();
    showToast(`已撤销 ${entry.word} 的最近评分`, 1800);
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
    sessionId?: string,
  ): boolean {
    if (!wordIds.length) {
      showToast("当前没有可加入学习队列的单词", 1800);
      return false;
    }
    const session = createActiveSession(kind, title, wordIds, originKind);
    if (session && sessionId) setActiveSession({ ...session, id: sessionId });
    if (ratingUndoTimerRef.current !== undefined) {
      window.clearTimeout(ratingUndoTimerRef.current);
      ratingUndoTimerRef.current = undefined;
    }
    setUndoVisible(false);
    beginLearning();
    setRevealed(false);
    setActiveView("learn");
    showToast(`已建立${title} · ${wordIds.length} 词`, 1800);
    return true;
  }

  function startTodaySession(): boolean {
    return startSession(
      "today",
      "今日任务",
      todayTaskPreview.wordIds,
    );
  }

  // 学习卡一键补漏：当前词加入今日任务（独立轻量会话，不动 buildTodayQueue）
  function startTodayWithCurrent(): boolean {
    if (current.id === undefined) {
      showToast("当前单词未关联学习项", 1800);
      return false;
    }
    return startSession("today", "今日任务 · 补漏", [current.id]);
  }

  function startFavoriteSession() {
    startSession("favorites", "收藏复习", favorites.map((item) => item.wordId));
  }

  function startMistakeSession() {
    startSession("mistakes", "错词强化", weakWordIds(wordProgress));
  }

  function startStubbornTreatment(
    treatment: Extract<SprintTreatmentRecommendation, { dimension: "stubborn" }>,
  ) {
    const now = new Date();
    const sessionId = createStubbornSprintSessionId(treatment.mode, now);
    if (treatment.mode === "lookup-recall") {
      return startSession(
        "stubborn",
        "顽固词多模式强化 · 词义主动回忆",
        treatment.wordIds,
        undefined,
        sessionId,
      );
    }
    setActiveQuiz({
      ...createQuizSession(treatment.mode, now.getTime(), now),
      id: sessionId,
    });
    clearSession();
    setActiveView("quiz");
    showToast(`已进入顽固词${treatment.label}阶段 · ${treatment.wordIds.length} 词`, 1800);
    return true;
  }

  function startStubbornSession() {
    if (stubbornTreatment) startStubbornTreatment(stubbornTreatment);
    else showToast("当前没有可强化的活跃顽固词", 1800);
  }

  function startLookupSession(wordIds = lookupWords.map(learningWordId)) {
    startSession("lookups", "划词集复习", wordIds);
  }

  function startSprintSession() {
    if (sprintTreatment) {
      if (sprintTreatment.dimension === "stubborn") {
        startStubbornTreatment(sprintTreatment);
        return;
      }
      const now = new Date();
      if (sprintTreatment.mode === "lookup-recall") {
        startSession(
          "sprint",
          "考前薄弱冲刺 · 词义主动回忆",
          sprintTreatment.wordIds,
          undefined,
          createTreatmentSprintSessionId("lookup-recall", now),
        );
        return;
      }
      setActiveQuiz({
        ...createQuizSession(sprintTreatment.mode, now.getTime(), now),
        id: createTreatmentSprintSessionId(sprintTreatment.mode, now),
      });
      clearSession();
      setActiveView("quiz");
      showToast(`已按薄弱维度推荐${sprintTreatment.label} · ${sprintTreatment.wordIds.length} 词`, 1800);
      return;
    }
    startSession(
      "sprint",
      "考前薄弱冲刺",
      sprintWordIds,
      undefined,
      createTreatmentSprintSessionId("generic-sprint"),
    );
  }

  // 集中区按分册/单元发起冲刺：只带该区域命中薄弱信号的词
  function startScopedSprint(section: string, unit?: string) {
    const scope = unit === undefined ? { section } : { section, unit };
    const wordIds = buildScopedSprintWordIds(
      weakSignalInput,
      wordById,
      scope,
      weakThresholds,
    );
    if (!wordIds.length) {
      showToast("该区域暂无薄弱词可冲刺", 1800);
      return;
    }
    startSession(
      "sprint",
      `薄弱冲刺 · ${section}${unit ? ` ${unit}` : ""}`,
      wordIds,
      undefined,
      createTreatmentSprintSessionId("generic-sprint"),
    );
  }
  // 从完成页一键再冲刺：只带「仍需关注」的词
  function startResprintSession() {
    const stillWeakIds = sprintCompletionSummary?.stillWeakWords.map(
      (item) => item.wordId,
    ) ?? [];
    startSession(
      "sprint",
      "薄弱冲刺 · 补漏",
      stillWeakIds,
      undefined,
      createTreatmentSprintSessionId("generic-sprint"),
    );
  }

  // 从轨迹页当前仍薄弱追踪一键再冲刺：只带当前仍薄弱词
  function startSprintFromRelapse() {
    const wordIds = sprintRelapse?.relapsedIds ?? [];
    if (!wordIds.length) {
      showToast("暂无当前仍薄弱词可冲刺", 1800);
      return;
    }
    startSession(
      "sprint",
      "薄弱冲刺 · 再次处置",
      wordIds,
      undefined,
      createTreatmentSprintSessionId("generic-sprint"),
    );
  }
  // 从轨迹页冲刺记录再跑一次：复用该次冲刺的词集
  function startSprintFromHistory(sessionId: string) {
    const wordIds = buildSprintRecordWordIds(reviews, sessionId);
    startSession(
      "sprint",
      "薄弱冲刺 · 历史复跑",
      wordIds,
      undefined,
      createTreatmentSprintSessionId("generic-sprint"),
    );
  }

  // 复制薄弱冲刺清单：多行「词 — 信号1、信号2」文本
  function copySprintSummary() {
    const lines = sprintSummary.map((item) =>
      `${item.word} — ${item.signals.join("、")}`);
    if (!lines.length) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(lines.join("\n"))
        .then(() => showToast("已复制薄弱清单", 1800))
        .catch(() => showToast("复制失败，请手动记录", 1800));
    } else {
      showToast("当前环境不支持复制", 1800);
    }
  }

  // 导出薄弱冲刺清单 CSV：Blob 下载，完成后释放对象 URL
  function exportSprintCsv() {
    const csv = buildSprintCsv(sprintSummary);
    if (!csv) {
      showToast("暂无薄弱清单可导出", 1800);
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "薄弱冲刺清单.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("已导出薄弱清单 CSV", 1800);
  }
  // 导出薄弱候选清单 CSV：复用 buildSprintCsv 转义与 BOM
  function exportWeakCandidateCsv() {
    const csv = buildSprintCsv(
      buildWeakCandidateSummary(weakSignalInput, wordById, weakThresholds),
    );
    if (!csv) {
      showToast("暂无薄弱候选可导出", 1800);
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "薄弱候选清单.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("已导出薄弱候选 CSV", 1800);
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
          setUndoVisible(false);
          setSearchOpen(true);
        },
      };
    }
    if (sourceKind === "sprint") {
      return {
        label: "返回轨迹页",
        onClick: () => {
          clearSession();
          if (ratingUndoTimerRef.current !== undefined) {
            window.clearTimeout(ratingUndoTimerRef.current);
            ratingUndoTimerRef.current = undefined;
          }
          setUndoVisible(false);
          setActiveView("history");
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

  function recordGuessMistake() {
    if (current.id === undefined) return;
    setGuessMistakes((items) => ({
      ...items,
      [current.id!]: (items[current.id!] ?? 0) + 1,
    }));
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

  // 例句来源词跳转：sourceId 缺省或词不在词库时静默降级为纯文本
  function focusSourceWord(sourceId: number | undefined, sourceWord: string) {
    if (sourceId === undefined) return;
    const target = wordById.get(sourceId);
    if (!target) {
      showToast(`词库中未找到「${sourceWord}」`, 1800);
      return;
    }
    focusSavedWord(target);
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
    { id: "quiz", label: "测验", mark: "✓" },
    { id: "history", label: "轨迹", mark: "↗" },
    { id: "settings", label: "设置", mark: "○" },
  ] as const;

  return (
    <main
      className="app-shell"
      aria-busy={operationInProgress || loadStatus === "loading"}
    >
      {!started && <WelcomeScreen onBegin={beginFromWelcome} />}
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

      <aside
        className="side-rail"
        aria-label="主导航"
        inert={!started || operationInProgress || loadStatus === "loading" || (isMobile && aiOpen)}
      >
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

      <section
        className="workspace"
        inert={!started || operationInProgress || loadStatus === "loading" || (isMobile && aiOpen)}
      >
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
          <div className={!activeSession && redbookReady
            ? "learn-view has-today-preview"
            : "learn-view"}
          >
            {!activeSession && redbookReady && (
              <button
                type="button"
                className="today-task-strip"
                onClick={startTodaySession}
                disabled={todayTaskPreview.complete}
                aria-label={todayTaskPreview.complete
                  ? `今日任务已完成。${todayTaskPreview.goalExplanation}`
                  : `开始今日任务，共 ${todayTaskPreview.totalCount} 词：到期复习 ${todayTaskPreview.dueCount}，反复查词补漏 ${todayTaskPreview.lookupCount}，新词 ${todayTaskPreview.newCount}。预计约 ${todayTaskPreview.estimatedMinutes} 分钟，粗略估算。${todayTaskPreview.goalExplanation}`}
              >
                <span className="today-task-title">今日任务预览</span>
                <strong>
                  {todayTaskPreview.complete
                    ? "今日任务已完成"
                    : `${todayTaskPreview.totalCount} 词 · 约 ${todayTaskPreview.estimatedMinutes} 分钟`}
                </strong>
                <span className="today-task-breakdown">
                  <b>到期 {todayTaskPreview.dueCount}</b>
                  <b>补漏 {todayTaskPreview.lookupCount}</b>
                  <b>新词 {todayTaskPreview.newCount}</b>
                </span>
                <small>{todayTaskPreview.goalExplanation}</small>
                <em>{todayTaskPreview.complete ? "无需额外安排" : "粗略估算 · 开始 →"}</em>
              </button>
            )}
            {sessionComplete && sessionCompletionSummary && (
              <SessionCompleteView
                summary={sessionCompletionSummary}
                sprintSummary={sprintCompletionSummary}
                sprintDimensionTrend={sprintDimensionTrend ?? []}
                onResprint={startResprintSession}
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
                onUndo={undoStack.length ? undoLastRating : undefined}
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
                redbookLoadGuidance={redbookLoadGuidance}
                current={current}
                currentSenses={currentSenses}
                currentFamiliarMeanings={currentFamiliarMeanings}
                currentEnrichment={currentEnrichment}
                currentProgress={currentProgress}
                isFavorite={isFavorite}
                hasRecordedAudio={hasRecordedAudio}
                hideChineseMeaning={hideChineseMeaning}
                guessContextFirst={guessContextFirst}
                currentSenseFrequency={
                  current.id === undefined ? undefined : senseFrequency[current.id]
                }
                frequencyLoading={frequencyLoading}
                reusedSentences={currentReusedSentences}
                guessMistakeCount={
                  current.id === undefined ? 0 : guessMistakes[current.id] ?? 0
                }
                currentLookupStat={currentLookupStat}
                currentRecallStats={
                  current.id === undefined ? undefined : weakProfiles[current.id]?.recall
                }
                sprintWeakSignals={
                  current.id !== undefined
                    ? buildWordWeakSignals(current.id, weakSignalInput, undefined, weakThresholds)
                    : undefined
                }
                sprintWeakLabel={
                  activeSession?.kind === "sprint"
                    ? "本词因以下信号进入冲刺："
                    : "本词存在薄弱信号："
                }
                onAddToToday={() => startTodayWithCurrent()}
                signalTimelineText={
                  current.id === undefined
                    ? undefined
                    : buildWordSignalTimeline(current.id, weakSignalInput, weakThresholds)
                        .map((event) => `${new Date(event.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} ${event.detail}`)
                        .join("\n") || undefined
                }
                stabilizedDimensions={currentStabilizedDimensions}
                onFocusSourceWord={focusSourceWord}
                activeSession={activeSession}
                wordSource={currentWordSource}
                newCount={stats.newCount}
                clock={clock}
                reinforcementInput={reinforcementInput}
                reinforcementFeedback={reinforcementFeedback}
                reinforcementSentence={reinforcementSentence}
                reinforcementMeaning={reinforcementMeaning}
                enrichmentLoading={enrichmentLoading}
                reviewingSense={reviewingSense}
                rewritingSense={rewritingSense}
                unfamiliarMeanings={unfamiliarMeanings}
                onReveal={() => setRevealed(true)}
                onRetryRedbookLoad={retryRedbookLoad}
                onToggleFavorite={() => toggleFavorite()}
                onSpeak={speak}
                onToggleMeaningFamiliar={toggleMeaningFamiliar}
                onEnrichWord={enrichCurrentWord}
                onGenerateSenseFrequency={generateSenseFrequency}
                onGuessMistake={recordGuessMistake}
                onReportSenseMismatch={reportSenseMismatch}
                onRewriteSenseExample={rewriteSenseExample}
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
            weakSignalsByWordId={weakSignalsByWordId}
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
            lookupStats={lookupStats}
            lookupWeakCandidateIds={weakLookupCandidateIds}
            weakSignalsByWordId={weakSignalsByWordId}
            weakRecallByWordId={weakRecallByWordId}
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
            onExportWeakCandidateCsv={exportWeakCandidateCsv}
            onRemoveLookup={(item) => {
              const identity = lookupIdentity(item);
              setLookupWords((items) =>
                items.filter((word) => lookupIdentity(word) !== identity));
            }}
            onNavigateLearn={() => setActiveView("learn")}
          />
        )}

        {activeView === "quiz" && (
          <QuizView
            words={redbookWords}
            wordProgress={wordProgress}
            familiarMeanings={familiarMeanings}
            lookupStats={lookupStats}
            lookupWords={lookupWords}
            senseFrequency={senseFrequency}
            stubbornWords={stubbornWords}
            soundOn={soundOn}
            onSpeak={speakWord}
            onRecordResult={recordQuizResult}
            savedQuiz={activeQuiz}
            onQuizStateChange={setActiveQuiz}
            candidateWordIds={activeQuizCandidateWordIds}
          />
        )}

        {activeView === "history" && (
          <HistoryView
            stats={stats}
            effectiveNewGoal={effectiveNewGoal}
            dailyGoal={dailyGoal}
            reviews={reviews}
            lookupStats={lookupStats}
            lookupWords={lookupWords}
            clock={clock}
            activityRange={activityRange}
            activityOffset={activityOffset}
            activityRangeLabels={activityRangeLabels}
            selectedActivityDate={selectedActivityDate}
            ratingLabels={ratingLabels}
            insights={insights}
            reviewForecast={reviewForecast}
            weeklyReport={weeklyReport}
            weakTrendSeries={weakTrendSeries}
            examPhase={examPlan?.phase}
            examProgress={examProgress}
            sprintHistory={sprintHistory}
            sprintCount={sprintWordIds.length}
            onResprintHistory={startSprintFromHistory}
            onStartSprint={startSprintSession}
            onCopySprint={copySprintSummary}
            onExportSprint={exportSprintCsv}
            weakConcentration={weakConcentration}
            sprintEffectivenessSeries={sprintEffectivenessSeries}
            sprintRelapseSeries={sprintRelapseSeries}
            sprintRetentionSeries={sprintRetentionSeries}
            dimensionObservationReport={dimensionObservationReport}
            sprintRelapse={sprintRelapse}
            sprintRelapseWords={sprintRelapseWords}
            onSprintRelapse={startSprintFromRelapse}
            sprintDimensionTrend={sprintDimensionTrend ?? []}
            sectionUnitTotals={sectionUnitTotals}
            onScopedSprint={startScopedSprint}
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
            examProgress={examProgress}
            soundOn={soundOn}
            hideChineseMeaning={hideChineseMeaning}
            guessContextFirst={guessContextFirst}
            weakThresholds={weakThresholds}
            weakLookupCandidateWords={weakLookupCandidateWords}
            weakLookupCandidateCount={weakLookupCandidateIds.length}
            weakLookupPriorityCount={lookupPriorityIds.length}
            weakSprintCount={sprintWordIds.length}
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
            undoCount={undoStack.length}
            onDailyGoalChange={setDailyGoal}
            onAdaptiveChange={setAdaptiveNewWords}
            onMinWordsChange={setMinimumNewWords}
            onExamDateChange={setExamDate}
            onSoundChange={setSoundOn}
            onHideChineseMeaningChange={setHideChineseMeaning}
            onGuessContextFirstChange={setGuessContextFirst}
            onWeakThresholdsChange={setWeakThresholds}
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
            onClearUndoHistory={() => {
              setUndoStack([]);
              setUndoVisible(false);
              showToast("撤销历史已清空", 1800);
            }}
            importInputRef={importInputRef}
          />
        )}
      </section>

      {selectionLookup && (
        <SelectionLookupPopup
          lookup={selectionLookup}
          onTranslate={translateSelection}
          onSpeak={() => {
            const result = selectionLookup.result;
            if (result) speakWord(result.query, result.linkedWordId);
          }}
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

      {(toast || (undoVisible && undoStack.length > 0)) && (
        <div className="toast" role="status">
          {toast && <span>{toast}</span>}
          {undoVisible && undoStack.length > 0 && (
            <button type="button" onClick={undoLastRating}>撤销</button>
          )}
        </div>
      )}

      {/* 常驻撤销按钮：提示条隐藏后仍可随时撤回 */}
      {!undoVisible && undoStack.length > 0 && (
        <button
          className="undo-forever"
          type="button"
          onClick={undoLastRating}
          aria-label={`撤销上一步（还有 ${undoStack.length} 步）`}
          title="撤销最近评分 (Z)"
        >
          <span>↩</span>
          撤销上一步
          {undoStack.length > 1 && <small>{undoStack.length}</small>}
        </button>
      )}
    </main>
  );
}
