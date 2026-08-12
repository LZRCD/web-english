"use client";

import type { WordProgressMap } from "../../lib/learning";
import { dueWordIds } from "../../lib/learning";
import { isPrimaryLearningWord } from "../../lib/redbook";
import type { Word } from "../../lib/study";

type SectionMeta = {
  name: string;
  detail: string;
  total: number;
  color: string;
  marker: string;
};

type BooksViewProps = {
  sectionMeta: SectionMeta[];
  redbookWords: Word[];
  wordProgress: WordProgressMap;
  weakSignalsByWordId: Record<number, string[]>;
  learningItemCount: number;
  clock: number;
  onSelectBook: (section: string, unit: number | string) => void;
  onAllShuffle: () => void;
};

export default function BooksView({
  sectionMeta,
  redbookWords,
  wordProgress,
  weakSignalsByWordId,
  learningItemCount,
  clock,
  onSelectBook,
  onAllShuffle,
}: BooksViewProps) {
  const now = new Date(clock);
  const due = new Set(dueWordIds(wordProgress, now));

  return (
    <div className="content-view books-view">
      <div className="section-heading">
        <div><p className="eyebrow">2027 考研英语红宝书</p><h1>按红宝书顺序开始</h1></div>
        <div className="book-heading-actions">
          <span className="resource-badge">本地资源 · 6550 原书词条 · {learningItemCount} 学习项</span>
          <button className="primary-button" onClick={onAllShuffle}>全书乱序</button>
        </div>
      </div>
      <div className="book-grid">
        {sectionMeta.map((book) => {
          const bookWordIds = redbookWords
            .filter((word) => word.section === book.name && word.id !== undefined && isPrimaryLearningWord(word.id))
            .map((word) => word.id!);
          const learned = bookWordIds.filter((wordId) => wordProgress[wordId]).length;
          const mastered = bookWordIds.filter((wordId) => wordProgress[wordId]?.status === "mastered").length;
          const dueCount = bookWordIds.filter((wordId) => due.has(wordId)).length;
          // 薄弱词数：复用全态薄弱画像，避免与学习卡/集中区/复发入口口径分叉
          const weakCount = bookWordIds.filter((wordId) =>
            (weakSignalsByWordId[wordId]?.length ?? 0) > 0).length;
          // 薄弱单元分布与词书总数使用同一画像
          const weakUnits = (() => {
            const counts = new Map<string, number>();
            for (const word of redbookWords) {
              if (
                word.section !== book.name
                || word.id === undefined
                || !isPrimaryLearningWord(word.id)
              ) continue;
              if (!(weakSignalsByWordId[word.id]?.length ?? 0)) continue;
              const unitKey = word.unit === undefined ? "未分单元" : `Unit ${word.unit}`;
              counts.set(unitKey, (counts.get(unitKey) ?? 0) + 1);
            }
            return [...counts.entries()].sort((a, b) => b[1] - a[1]);
          })();
          return (
          <button className="book-card" key={book.name} onClick={() => {
            onSelectBook(book.name, book.name === "超纲词" ? "A" : 1);
          }}>
            <span className={`book-swatch ${book.color}`}>{book.marker}</span>
            <div>
              <small>{book.detail}</small>
              <h2>{book.name}</h2>
              <p>{learned} 已学习 · {mastered} 已掌握 · {dueCount} 待复习 · <span className="book-weak-count">{weakCount} 薄弱</span></p>
              {weakUnits.length > 0 && (
                <p className="book-weak-units">
                  薄弱集中：{weakUnits.slice(0, 3).map(([unit, count]) => `${unit} · ${count} 词`).join("、")}
                  {weakUnits.length > 3 ? ` 等 ${weakUnits.length} 个单元` : ""}
                </p>
              )}
            </div>
            <div className="book-line">
              <i style={{ width: `${(learned / book.total) * 100}%` }} />
              {weakCount > 0 && (
                <i
                  className="book-line-weak"
                  style={{ width: `${Math.min(100, (weakCount / book.total) * 100)}%` }}
                />
              )}
            </div>
          </button>
        )})}
        <button className="book-card empty-book all-book-card" onClick={onAllShuffle}>
          <span>{learningItemCount}</span>
          <h2>全书乱序</h2>
          <p className="all-book-cta">随机开始 →</p>
        </button>
      </div>
    </div>
  );
}
