import { expect, test } from "@playwright/test";
import { createState } from "./fixtures.mjs";
import {
  installStateSeed,
  openApp,
  readStoreRecord,
  selectText,
} from "./helpers.mjs";

const SENTENCE = "State appears in this synthetic identity sentence.";
const SAVED_LOOKUP = {
  id: 9_000_001_330,
  linkedWordId: 1330,
  query: "state",
  kind: "word",
  phonetic: "/steit/",
  phoneticSource: "redbook",
  part: "n.",
  meaning: "合成关联释义",
  note: "必考词 · Unit 19",
  source: "redbook",
  addedAt: "2026-08-01T00:00:00.000Z",
};

const SYNTHETIC_REDBOOK = {
  metadata: {
    title: "合成红宝书",
    total: 1,
    sectionCounts: { 必考词: 1, 基础词: 0, 超纲词: 0 },
  },
  words: [{
    id: 1,
    word: "alpha",
    phonetic: "/ˈælfə/",
    meaning: "n. 合成词",
    sentence: SENTENCE,
    translation: "State 出现在合成身份句子中。",
    section: "必考词",
    unit: 1,
  }],
};

async function installSyntheticNetwork(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.pathname.startsWith("/api/")
      || url.pathname.startsWith("/data/sense-frequency/")
      || url.pathname.startsWith("/data/sense-examples/")
      || url.pathname.startsWith("/data/etymology/")
    ) {
      await route.abort();
      return;
    }
    if (url.pathname === "/data/redbook.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SYNTHETIC_REDBOOK),
      });
      return;
    }
    if (url.pathname === "/data/redbook-analysis.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          metadata: { auditedEntries: 6550, learningItemCount: 1 },
          entries: { 1: {} },
        }),
      });
      return;
    }
    await route.continue();
  });
}

async function selectSavedLookup(page) {
  await selectText(page.getByText(SENTENCE, { exact: true }), "State");
  const popup = page.getByRole("dialog", { name: "划词查询：State" });
  await expect(popup).toContainText("合成关联释义");
  await expect(popup).toContainText("已加入划词集");
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
}

test("savedLookup 索引未命中后重复保存仍保持单一红宝书 identity", async ({
  context,
  page,
}) => {
  await installSyntheticNetwork(page);
  await installStateSeed(context, createState({ lookupWords: [SAVED_LOOKUP] }));
  await openApp(page);
  await page.getByRole("button", { name: "显示单词释义" }).click();

  await selectSavedLookup(page);
  await selectSavedLookup(page);

  const stored = await expect.poll(async () => {
    const settings = await readStoreRecord(page, "settings", "current");
    return settings?.lookupWords?.map((word) => ({
      addedAt: word.addedAt,
      id: word.id,
      identity: word.linkedWordId === undefined
        ? `lookup:${word.query.trim().toLowerCase()}`
        : `redbook:${word.linkedWordId}`,
      linkedWordId: word.linkedWordId,
    }));
  }).toEqual([{
    addedAt: SAVED_LOOKUP.addedAt,
    id: SAVED_LOOKUP.id,
    identity: "redbook:1330",
    linkedWordId: SAVED_LOOKUP.linkedWordId,
  }]);
  void stored;
});
