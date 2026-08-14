import { expect } from "@playwright/test";
import {
  DATABASE_NAME,
  STORAGE_KEY,
} from "./fixtures.mjs";

const SEED_SENTINEL = "wordloop-e2e-seeded";

export async function installStateSeed(
  context,
  state,
  additionalStorage = {},
) {
  await context.addInitScript(
    ({ seedState, storageEntries, sentinel, storageKey }) => {
      if (!["http:", "https:"].includes(globalThis.location.protocol)) return;
      if (globalThis.localStorage.getItem(sentinel) === "1") return;
      globalThis.localStorage.setItem(storageKey, JSON.stringify(seedState));
      for (const [key, value] of Object.entries(storageEntries)) {
        globalThis.localStorage.setItem(key, value);
      }
      globalThis.localStorage.setItem(sentinel, "1");
    },
    {
      seedState: state,
      storageEntries: additionalStorage,
      sentinel: SEED_SENTINEL,
      storageKey: STORAGE_KEY,
    },
  );
}

export async function installSilentBroadcastChannel(context) {  await context.addInitScript(() => {
    class SilentBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
      }

      postMessage() {
        return undefined;
      }

      close() {
        return undefined;
      }

      addEventListener() {
        return undefined;
      }

      removeEventListener() {
        return undefined;
      }
    }

    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: SilentBroadcastChannel,
    });
  });
}

export async function readStoreRecord(page, storeName, key) {
  return page.evaluate(
    ({ databaseName, requestedStore, requestedKey }) =>
      new Promise((resolve, reject) => {
        const openRequest = globalThis.indexedDB.open(databaseName);
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          if (
            requestedStore !== "backups"
            && database.objectStoreNames.contains("state-domains")
          ) {
            const transaction = database.transaction("state-domains", "readonly");
            const request = transaction.objectStore("state-domains").get(requestedStore);
            request.onerror = () => {
              database.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              const domain = request.result;
              let result = null;
              if (requestedStore === "settings" && requestedKey === "current") {
                result = domain
                  ? { id: "current", revision: domain.revision, ...domain.value }
                  : null;
              } else if (Array.isArray(domain?.value)) {
                const keyField = requestedStore === "reviews"
                  ? "id"
                  : requestedStore === "positions"
                    ? "key"
                    : "wordId";
                result = domain.value.find(
                  (item) => item?.[keyField] === requestedKey,
                ) ?? null;
              }
              transaction.oncomplete = () => {
                database.close();
                resolve(result);
              };
            };
            return;
          }
          if (!database.objectStoreNames.contains(requestedStore)) {
            database.close();
            resolve(null);
            return;
          }
          const transaction = database.transaction(requestedStore, "readonly");
          const request = transaction.objectStore(requestedStore).get(requestedKey);
          request.onerror = () => {
            database.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            const result = request.result ?? null;
            transaction.oncomplete = () => {
              database.close();
              resolve(result);
            };
          };
        };
      }),
    {
      databaseName: DATABASE_NAME,
      requestedStore: storeName,
      requestedKey: key,
    },
  );
}

export async function readStoreCount(page, storeName) {
  return page.evaluate(
    ({ databaseName, requestedStore }) =>
      new Promise((resolve, reject) => {
        const openRequest = globalThis.indexedDB.open(databaseName);
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          if (
            requestedStore !== "backups"
            && database.objectStoreNames.contains("state-domains")
          ) {
            const transaction = database.transaction("state-domains", "readonly");
            const request = transaction.objectStore("state-domains").get(requestedStore);
            request.onerror = () => {
              database.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              const domain = request.result;
              const result = requestedStore === "settings"
                ? Number(Boolean(domain))
                : Array.isArray(domain?.value)
                  ? domain.value.length
                  : 0;
              transaction.oncomplete = () => {
                database.close();
                resolve(result);
              };
            };
            return;
          }
          if (!database.objectStoreNames.contains(requestedStore)) {
            database.close();
            resolve(0);
            return;
          }
          const transaction = database.transaction(requestedStore, "readonly");
          const request = transaction.objectStore(requestedStore).count();
          request.onerror = () => {
            database.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            const result = request.result;
            transaction.oncomplete = () => {
              database.close();
              resolve(result);
            };
          };
        };
      }),
    {
      databaseName: DATABASE_NAME,
      requestedStore: storeName,
    },
  );
}

export async function readStoreSnapshot(page, storeName) {
  return page.evaluate(
    ({ databaseName, requestedStore }) =>
      new Promise((resolve, reject) => {
        const openRequest = globalThis.indexedDB.open(databaseName);
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          if (
            requestedStore !== "backups"
            && database.objectStoreNames.contains("state-domains")
          ) {
            const transaction = database.transaction("state-domains", "readonly");
            const request = transaction.objectStore("state-domains").get(requestedStore);
            request.onerror = () => {
              database.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              const snapshot = request.result?.value ?? null;
              transaction.oncomplete = () => {
                database.close();
                resolve(snapshot);
              };
            };
            return;
          }
          if (!database.objectStoreNames.contains(requestedStore)) {
            database.close();
            resolve(null);
            return;
          }
          const transaction = database.transaction(requestedStore, "readonly");
          const request = transaction.objectStore(requestedStore).getAll();
          request.onerror = () => {
            database.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            const snapshot = request.result ?? null;
            transaction.oncomplete = () => {
              database.close();
              resolve(snapshot);
            };
          };
        };
      }),
    {
      databaseName: DATABASE_NAME,
      requestedStore: storeName,
    },
  );
}

export async function waitForApp(page, { expectIndexedDb = true } = {}) {
  await expect(
    page.getByRole("button", { name: "显示单词释义" }),
  ).toBeEnabled({ timeout: 25_000 });
  if (expectIndexedDb) {
    await expect.poll(
      async () => Boolean(await readStoreRecord(page, "settings", "current")),
      { timeout: 10_000 },
    ).toBe(true);
  }
}

export async function openApp(page, options) {
  await page.goto("/");
  await waitForApp(page, options);
}

/**
 * 屏蔽三套私有预生成数据集的网络请求（模拟“数据不存在”），
 * 用于验证原有逐词生成入口回退行为的用例。
 */
export async function blockPrivateDatasets(page, { datasets = [
  "sense-frequency",
  "sense-examples",
  "etymology",
] } = {}) {
  for (const dataset of datasets) {
    await page.route(`**/data/${dataset}/**`, (route) => route.abort());
  }
}

/**
 * 展开轨迹页「详细学习分析」折叠面板。
 * 轨迹页高级数据默认渐进披露（折叠），断言内部模块前先展开；幂等。
 */
export async function openTraceAnalysis(page) {
  const details = page.locator('details[aria-label="详细学习分析"]');
  if (await details.count()) {
    if (!(await details.evaluate((el) => el.open))) {
      await details.locator(":scope > summary").click();
    }
  }
}

export async function openSettings(page) {
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /设置$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "把节奏调成你的样子" }),
  ).toBeVisible();
}

export async function openWordbook(page) {
  await page
    .getByRole("complementary", { name: "主导航" })
    .getByRole("button", { name: /词本$/ })
    .click();
  await expect(
    page.getByRole("tablist", { name: "词本分类" }),
  ).toBeVisible();
}

export function dailyGoalSelect(page) {
  return page.getByRole("combobox", { name: /^每日新词/ });
}

export function sessionBatchSizeSelect(page) {
  return page.getByRole("combobox", { name: /每批学习词数/ });
}

export async function selectText(locator, query) {
  await locator.evaluate((element, selectedQuery) => {
    const walker = globalThis.document.createTreeWalker(
      element,
      globalThis.NodeFilter.SHOW_TEXT,
    );
    let textNode = walker.nextNode();
    while (
      textNode
      && !textNode.textContent?.toLowerCase().includes(selectedQuery.toLowerCase())
    ) {
      textNode = walker.nextNode();
    }
    if (!textNode?.textContent) {
      throw new Error(`找不到待划选文本：${selectedQuery}`);
    }
    const start = textNode.textContent.toLowerCase().indexOf(selectedQuery.toLowerCase());
    const range = globalThis.document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + selectedQuery.length);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const box = range.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }));
  }, query);
}

export async function selectTextWithTouch(locator, query) {
  await locator.evaluate((element, selectedQuery) => {
    const walker = globalThis.document.createTreeWalker(
      element,
      globalThis.NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = textNode.textContent ?? "";
      const start = text.indexOf(selectedQuery);
      if (start < 0) continue;
      const range = globalThis.document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + selectedQuery.length);
      const selection = globalThis.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerType: "touch",
      }));
      return;
    }
    throw new Error(`找不到待划选文本：${selectedQuery}`);
  }, query);
}
