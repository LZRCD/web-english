import { expect, test } from "@playwright/test";
import {
  createState,
  RECOVERY_COPY_PREFIX,
} from "./fixtures.mjs";
import {
  dailyGoalSelect,
  installSilentBroadcastChannel,
  installStateSeed,
  openApp,
  openSettings,
  readStoreRecord,
  waitForApp,
} from "./helpers.mjs";

test("双标签并发写入时旧 revision 不会覆盖新数据", async ({ context }) => {
  await installStateSeed(context, createState());
  await installSilentBroadcastChannel(context);

  const firstPage = await context.newPage();
  await openApp(firstPage);
  const secondPage = await context.newPage();
  await openApp(secondPage);
  await openSettings(firstPage);
  await openSettings(secondPage);

  await dailyGoalSelect(firstPage).selectOption("30");
  await expect.poll(async () => {
    const settings = await readStoreRecord(firstPage, "settings", "current");
    return settings?.dailyGoal;
  }).toBe(30);

  await dailyGoalSelect(secondPage).selectOption("50");
  await expect(
    secondPage.getByRole("status").filter({ hasText: "另一标签页已有更新" }),
  ).toBeVisible();
  await expect(secondPage.getByText("保存失败，请先导出备份或重试")).toBeVisible();
  await expect(secondPage.getByText(/发现 1 份未合并的恢复副本/)).toBeVisible();
  const recoveryRaws = await secondPage.evaluate((recoveryPrefix) => {
    const raws = [];
    for (let index = 0; index < globalThis.localStorage.length; index += 1) {
      const key = globalThis.localStorage.key(index);
      if (!key?.startsWith(recoveryPrefix)) continue;
      const value = globalThis.localStorage.getItem(key);
      if (!value) continue;
      try {
        const collection = JSON.parse(value);
        for (const copy of collection.copies ?? []) {
          if (typeof copy.raw === "string") raws.push(copy.raw);
        }
      } catch {
        // 无效副本会由应用忽略；测试只检查可读取的恢复副本。
      }
    }
    return raws;
  }, RECOVERY_COPY_PREFIX);
  expect(recoveryRaws).toEqual(
    expect.arrayContaining([expect.stringContaining('"dailyGoal":50')]),
  );
  expect(
    recoveryRaws
      .map((raw) => JSON.parse(raw))
      .some((recoveryState) => recoveryState.dailyGoal === 50),
  ).toBe(true);
  const authoritativeSettings = await readStoreRecord(
    firstPage,
    "settings",
    "current",
  );
  expect(authoritativeSettings.dailyGoal).toBe(30);

  await secondPage.reload();
  await waitForApp(secondPage);
  await openSettings(secondPage);
  await expect(dailyGoalSelect(secondPage)).toHaveValue("30");
  await expect(secondPage.getByText(/发现 1 份未合并的恢复副本/)).toBeVisible();
});
