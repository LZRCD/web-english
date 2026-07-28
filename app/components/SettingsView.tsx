"use client";

import {
  adaptiveNewWordGoal,
  type ExamPlan,
} from "../../lib/learning";
import type { AutomaticBackup } from "../../lib/backup";
import type { StudyMode, StudyScope } from "../../lib/study";

type SettingsViewProps = {
  dailyGoal: number;
  adaptiveNewWords: boolean;
  minimumNewWords: number;
  examDate: string;
  examPlan: ExamPlan | null;
  soundOn: boolean;
  studyMode: StudyMode;
  studyScope: StudyScope;
  learningItemCount: number;
  aiMode: "unknown" | "cloud" | "local";
  automaticBackups: AutomaticBackup[];
  stats: { dueCount: number };
  effectiveNewGoal: number;
  onDailyGoalChange: (value: number) => void;
  onAdaptiveChange: (value: boolean) => void;
  onMinWordsChange: (value: number) => void;
  onExamDateChange: (value: string) => void;
  onSoundChange: (value: boolean) => void;
  onModeChange: (mode: StudyMode | "all") => void;
  onExportBackup: () => void;
  onImportClick: () => void;
  onRestoreBackup: (id: string) => void;
  onResetRecords: () => void;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  startAllBookShuffle: (openLearning?: boolean) => void;
  changeStudyMode: (mode: StudyMode) => void;
};

export default function SettingsView({
  dailyGoal,
  adaptiveNewWords,
  minimumNewWords,
  examDate,
  examPlan,
  soundOn,
  studyMode,
  studyScope,
  learningItemCount,
  aiMode,
  automaticBackups,
  stats,
  effectiveNewGoal,
  onDailyGoalChange,
  onAdaptiveChange,
  onMinWordsChange,
  onExamDateChange,
  onSoundChange,
  onModeChange,
  onExportBackup,
  onImportClick,
  onRestoreBackup,
  onResetRecords,
  importInputRef,
  startAllBookShuffle,
  changeStudyMode,
}: SettingsViewProps) {
  return (
    <div className="content-view settings-view">
      <div className="section-heading"><div><p className="eyebrow">偏好设置</p><h1>把节奏调成你的样子</h1></div></div>
      <div className="settings-panel">
        <label>
          <span><strong>每日新词</strong><small>保持一个能够长期坚持的数量</small></span>
          <select value={dailyGoal} onChange={(event) => onDailyGoalChange(Number(event.target.value))}>
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
            disabled={!adaptiveNewWords}
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
          </span>
          <input
            type="date"
            value={examDate}
            onChange={(event) => onExamDateChange(event.target.value)}
            aria-label="考研日期"
          />
        </label>
        <label>
          <span><strong>自动播放发音</strong><small>切换到下一个单词时播放美音</small></span>
          <input type="checkbox" checked={soundOn} onChange={(event) => onSoundChange(event.target.checked)} />
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
            <button type="button" onClick={onExportBackup}>导出备份</button>
            <button type="button" onClick={onImportClick}>导入备份</button>
            {automaticBackups[0] && (
              <button type="button" className="quiet" onClick={() => onRestoreBackup(automaticBackups[0].id)}>
                恢复最近快照
              </button>
            )}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={() => {}}
          />
        </div>
        <button className="reset-button" onClick={onResetRecords}>
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
  );
}
