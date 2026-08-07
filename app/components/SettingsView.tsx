"use client";

import type { ChangeEvent, RefObject } from "react";
import type { ExamPlan, ExamProgressTiers } from "../../lib/learning";
import type { AutomaticBackup } from "../../lib/backup";
import type { StudyMode, StudyScope, WeakThresholds } from "../../lib/study";
import PerformanceDiagnostics from "./PerformanceDiagnostics";

type SettingsViewProps = {
  dailyGoal: number;
  adaptiveNewWords: boolean;
  minimumNewWords: number;
  examDate: string;
  examPlan: ExamPlan | null;
  examProgress: ExamProgressTiers | null;
  soundOn: boolean;
  /** 隐藏学习卡下方释义的中文 */
  hideChineseMeaning: boolean;
  /** 多释义单词先显示英文语境句 */
  guessContextFirst: boolean;
  /** 薄弱判定阈值（反复查词/插队/回忆偏慢） */
  weakThresholds: WeakThresholds;
  studyMode: StudyMode;
  studyScope: StudyScope;
  learningItemCount: number;
  aiMode: "unknown" | "cloud" | "local";
  automaticBackups: AutomaticBackup[];
  stats: { dueCount: number };
  effectiveNewGoal: number;
  saveStatus: "idle" | "saving" | "saved" | "fallback" | "error";
  lastSaveTime: number;
  dataActionsDisabled: boolean;
  dataReplacementDisabled: boolean;
  dataActionsLoading: "hydrating" | "authoritative" | null;
  recoveryCopies: Array<{
    id: string;
    createdAt: string;
    restorable: boolean;
  }>;
  undoCount: number;
  onDailyGoalChange: (value: number) => void;
  onAdaptiveChange: (value: boolean) => void;
  onMinWordsChange: (value: number) => void;
  onExamDateChange: (value: string) => void;
  onSoundChange: (value: boolean) => void;
  onHideChineseMeaningChange: (value: boolean) => void;
  onGuessContextFirstChange: (value: boolean) => void;
  onWeakThresholdsChange: (thresholds: WeakThresholds) => void;
  onModeChange: (mode: StudyMode | "all") => void;
  onExportBackup: () => void;
  onImportClick: () => void;
  onImportBackup: (event: ChangeEvent<HTMLInputElement>) => void;
  onRestoreBackup: (id: string) => void;
  onRetrySave: () => void;
  onExportRecovery: (id: string) => void;
  onRestoreRecovery: (id: string) => void;
  onDiscardRecovery: (id: string) => void;
  onResetRecords: () => void;
  onClearUndoHistory: () => void;
  importInputRef: RefObject<HTMLInputElement | null>;
};

export default function SettingsView({
  dailyGoal,
  adaptiveNewWords,
  minimumNewWords,
  examDate,
  examPlan,
  examProgress,
  soundOn,
  hideChineseMeaning,
  guessContextFirst,
  weakThresholds,
  studyMode,
  studyScope,
  learningItemCount,
  aiMode,
  automaticBackups,
  stats,
  effectiveNewGoal,
  saveStatus,
  lastSaveTime,
  dataActionsDisabled,
  dataReplacementDisabled,
  dataActionsLoading,
  recoveryCopies,
  undoCount,
  onDailyGoalChange,
  onAdaptiveChange,
  onMinWordsChange,
  onExamDateChange,
  onSoundChange,
  onHideChineseMeaningChange,
  onGuessContextFirstChange,
  onWeakThresholdsChange,
  onModeChange,
  onExportBackup,
  onImportClick,
  onImportBackup,
  onRestoreBackup,
  onRetrySave,
  onExportRecovery,
  onRestoreRecovery,
  onDiscardRecovery,
  onResetRecords,
  onClearUndoHistory,
  importInputRef,
}: SettingsViewProps) {
  const dataActionsLocked = dataActionsDisabled || dataActionsLoading !== null;
  const dataReplacementLocked =
    dataActionsLocked || dataReplacementDisabled;
  const dataActionsStatus = dataActionsLoading === "hydrating"
    ? "正在读取本地数据，数据操作暂不可用…"
    : dataActionsLoading === "authoritative"
      ? "正在安全写入数据，请稍候…"
      : dataReplacementDisabled
        ? "本地数据尚未安全载入，可导出、导入备份或重试保存。"
        : dataActionsDisabled
          ? "数据操作暂不可用，请稍候…"
          : "";

  return (
    <div className="content-view settings-view">
      <div className="section-heading"><div><p className="eyebrow">偏好设置</p><h1>把节奏调成你的样子</h1></div></div>
      {dataActionsStatus && (
        <p className="data-actions-status" role="status" aria-live="polite">
          {dataActionsStatus}
        </p>
      )}
      <div className="settings-panel" aria-busy={dataActionsLocked}>
        <label>
          <span><strong>每日新词</strong><small>保持一个能够长期坚持的数量</small></span>
          <select
            value={dailyGoal}
            disabled={dataReplacementLocked}
            onChange={(event) => onDailyGoalChange(Number(event.target.value))}
          >
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
            disabled={dataReplacementLocked}
            onChange={(event) => onAdaptiveChange(event.target.checked)}
          />
        </label>
        <label>
          <span>
            <strong>最低新词量</strong>
            <small>积压再多也保留的最低数量；设为 0 可暂停新词</small>
          </span>
          <select
            value={minimumNewWords}
            disabled={!adaptiveNewWords || dataReplacementLocked}
            onChange={(event) => onMinWordsChange(Number(event.target.value))}
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
            {examProgress && (
              <small>
                备考就绪 {examProgress.examReady} 词：已覆盖 {examProgress.covered} · 已掌握 {examProgress.mastered} · 预测考试日可提取率 ≥ {examProgress.thresholdPercent}%
              </small>
            )}
          </span>
          <input
            type="date"
            value={examDate}
            disabled={dataReplacementLocked}
            onChange={(event) => onExamDateChange(event.target.value)}
            aria-label="考研日期"
          />
        </label>
        <label>
          <span><strong>自动播放发音</strong><small>切换到下一个单词时播放美音</small></span>
          <input
            type="checkbox"
            checked={soundOn}
            disabled={dataReplacementLocked}
            onChange={(event) => onSoundChange(event.target.checked)}
          />
        </label>
        <label>
          <span>
            <strong>隐藏释义中文</strong>
            <small>释义、生成例句与翻译的中文全部隐藏，先回忆再点“显示释义”核对</small>
          </span>
          <input
            type="checkbox"
            checked={hideChineseMeaning}
            disabled={dataReplacementLocked}
            onChange={(event) => onHideChineseMeaningChange(event.target.checked)}
          />
        </label>
        <label>
          <span>
            <strong>多释义先猜语境</strong>
            <small>有两个以上义项的单词，先给英文句子猜意思，再展开中文</small>
          </span>
          <input
            type="checkbox"
            checked={guessContextFirst}
            disabled={dataReplacementLocked}
            onChange={(event) => onGuessContextFirstChange(event.target.checked)}
          />
        </label>
        <div className="weak-thresholds-settings">
          <span className="weak-thresholds-title">
            <strong>薄弱判定阈值</strong>
            <small>调整后词本薄弱标签、划词补漏插队、考前冲刺与周报趋势都会同步生效</small>
          </span>
          <label>
            <span><strong>反复查词</strong><small>查过 ≥ 该次数的词标为薄弱候选并进入冲刺</small></span>
            <input
              type="number"
              min={1}
              max={20}
              value={weakThresholds.lookupWeak}
              disabled={dataReplacementLocked}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1 && value <= 20) {
                  onWeakThresholdsChange({ ...weakThresholds, lookupWeak: Math.trunc(value) });
                }
              }}
            />
          </label>
          <label>
            <span><strong>插队复习</strong><small>查过 ≥ 该次数的词自动插队今日任务</small></span>
            <input
              type="number"
              min={1}
              max={20}
              value={weakThresholds.lookupPriority}
              disabled={dataReplacementLocked}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1 && value <= 20) {
                  onWeakThresholdsChange({ ...weakThresholds, lookupPriority: Math.trunc(value) });
                }
              }}
            />
          </label>
          <label>
            <span><strong>回忆偏慢</strong><small>单次评分回忆 ≥ 该秒数判定为偏慢</small></span>
            <input
              type="number"
              min={1}
              max={120}
              value={Math.round(weakThresholds.slowRecallMs / 1000)}
              disabled={dataReplacementLocked}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1 && value <= 120) {
                  onWeakThresholdsChange({ ...weakThresholds, slowRecallMs: Math.trunc(value) * 1000 });
                }
              }}
            />
          </label>
        </div>
        <label>
          <span><strong>学习顺序</strong><small>可打乱当前单元，也可跨越全书 {learningItemCount} 个学习项</small></span>
          <select
            value={studyScope === "all" ? "all" : studyMode}
            disabled={dataReplacementLocked}
            onChange={(event) => onModeChange(event.target.value as StudyMode | "all")}
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
            {saveStatus !== "idle" && (
              <small className={`save-status save-status--${saveStatus}`}>
                {saveStatus === "saving" && "保存中…"}
                {saveStatus === "saved" && `已保存 ${new Date(lastSaveTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`}
                {saveStatus === "fallback" && "已保存到本机兼容存储"}
                {saveStatus === "error" && "保存失败，请先导出备份或重试"}
              </small>
            )}
            {examProgress && (
              <small>
                备考就绪 {examProgress.examReady} 词：已覆盖 {examProgress.covered} · 已掌握 {examProgress.mastered} · 预测考试日可提取率 ≥ {examProgress.thresholdPercent}%
              </small>
            )}
          </span>
          <div>
            <button type="button" disabled={dataActionsLocked} onClick={onExportBackup}>导出备份</button>
            <button type="button" disabled={dataActionsLocked} onClick={onImportClick}>导入备份</button>
            {saveStatus === "error" && (
              <button type="button" className="quiet" disabled={dataActionsLocked} onClick={onRetrySave}>
                重试保存
              </button>
            )}
            {automaticBackups[0] && (
              <button
                type="button"
                className="quiet"
                disabled={dataReplacementLocked}
                onClick={() => onRestoreBackup(automaticBackups[0].id)}
              >
                恢复最近快照
              </button>
            )}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            disabled={dataActionsLocked}
            onChange={onImportBackup}
          />
        </div>
        {recoveryCopies.length > 0 && (
          <div className="backup-settings recovery-settings" role="status">
            <span>
              <strong>发现 {recoveryCopies.length} 份未合并的恢复副本</strong>
              {recoveryCopies.map((copy, index) => (
                <small key={copy.id}>
                  {index + 1}. {new Date(copy.createdAt).toLocaleString("zh-CN")}
                  {copy.restorable ? " · 可恢复" : " · 仅可导出"}
                </small>
              ))}
            </span>
            <div className="recovery-copy-actions">
              {recoveryCopies.map((copy, index) => (
                <div key={copy.id}>
                  <small>副本 {index + 1}</small>
                  <button
                    type="button"
                    disabled={dataActionsLocked}
                    onClick={() => onExportRecovery(copy.id)}
                  >
                    导出
                  </button>
                  {copy.restorable && (
                    <button
                      type="button"
                      disabled={dataReplacementLocked}
                      onClick={() => onRestoreRecovery(copy.id)}
                    >
                      恢复
                    </button>
                  )}
                  <button
                    type="button"
                    className="quiet"
                    disabled={dataActionsLocked}
                    onClick={() => onDiscardRecovery(copy.id)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="backup-settings">
          <span>
            <strong>评分撤销历史</strong>
            <small>当前可撤销 {undoCount} 步，运行中最多保留 30 步</small>
          </span>
          <div>
            <button
              type="button"
              className="quiet"
              disabled={dataReplacementLocked || undoCount === 0}
              onClick={() => {
                if (window.confirm("清空全部评分撤销历史？已提交的评分不会被删除。")) {
                  onClearUndoHistory();
                }
              }}
            >
              清空撤销历史
            </button>
          </div>
        </div>
        <button
          type="button"
          className="reset-button"
          disabled={dataReplacementLocked}
          onClick={onResetRecords}
        >
          清空本机学习记录
        </button>
      </div>
      <details className="advanced-settings">
        <summary>高级设置</summary>
        <PerformanceDiagnostics undoCount={undoCount} />
      </details>
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
  );
}
