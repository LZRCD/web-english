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
    adaptiveNewWords: true,
    minimumNewWords: 5,
    examDate: "",
    soundOn: false,
    studyMode: "ordered",
    studyScope: "selection",
    shuffleSeed: 1,
    selectedSection: "必考词",
    selectedUnit: 1,
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
    collocations: ["radiate energy"],
    source: "dictionary",
    verified: true,
  },
};
