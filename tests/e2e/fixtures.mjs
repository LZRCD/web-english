export const STORAGE_KEY = "wordloop-state";
export const DATABASE_NAME = "wordloop-local";
export const RECOVERY_COPY_PREFIX = "wordloop-unsaved-recovery:";

export function createState(overrides = {}) {
  return {
    schemaVersion: 5,
    reviews: [],
    wordProgress: {},
    favorites: [],
    mistakes: [],
    stubbornWords: {},
    positions: {},
    enrichments: {},
    lookupWords: [],
    familiarMeanings: {},
    started: true,
    dailyGoal: 20,
    sessionBatchSize: 10,
    adaptiveNewWords: true,
    minimumNewWords: 5,
    examDate: "",
    soundOn: false,
    studyMode: "ordered",
    studyScope: "selection",
    shuffleSeed: 1,
    selectedSection: "必考词",
    selectedUnit: 1,
    ratingUndoStack: [],
    ...overrides,
  };
}

export function createBackup(state, exportedAt = "2026-07-29T06:00:00.000Z") {
  return {
    format: "wordloop-backup",
    schemaVersion: 5,
    exportedAt,
    state,
  };
}

export function createRecoveryCollection({
  id,
  state,
  createdAt,
}) {
  return JSON.stringify({
    format: "wordloop-recovery-collection-v1",
    copies: [{
      id,
      createdAt,
      raw: JSON.stringify(state),
    }],
  });
}

export const RADIATE_ENRICHMENT = {
  1: {
    sentence: "Stars radiate energy into space.",
    translation: "恒星向太空辐射能量。",
    senseExamples: [
      {
        meaning: "散发",
        sentence: "Stars radiate energy into space.",
        translation: "恒星向太空辐射能量。",
      },
      {
        meaning: "流露",
        sentence: "Her calm voice radiated confidence during the interview.",
        translation: "面试时，她平静的声音流露出自信。",
      },
      {
        meaning: "发出 (光、辐射等)",
        sentence: "A careful elucidator radiated light onto the old diagram.",
        translation: "一位细致的阐释者把光照在旧图表上。",
      },
      {
        meaning: "呈辐射状发散 (或伸展)",
        sentence: "Several narrow paths radiate from the central square.",
        translation: "几条狭窄的小路从中心广场向外伸展。",
      },
    ],
    targetMeanings: [
      "散发",
      "流露",
      "发出 (光、辐射等)",
      "呈辐射状发散 (或伸展)",
    ],
    collocations: ["radiate energy"],
    source: "dictionary",
    verified: true,
  },
};
