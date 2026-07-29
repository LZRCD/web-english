"use client";

import type { KeyboardEvent } from "react";
import { splitMeaning, type LookupWord, type MistakeRecord, type SavedWord, type Word } from "../../lib/study";
import { wordRetrievability, type StubbornWordRecord, type WordProgress } from "../../lib/learning";

type FavoriteWordItem = SavedWord & { word: Word };
type MistakeWordItem = MistakeRecord & { word: Word };
type StubbornWordItem = { record: StubbornWordRecord; progress?: WordProgress; word: Word };
type WordbookTab = "favorites" | "mistakes" | "stubborn" | "lookups";
const WORDBOOK_TABS: WordbookTab[] = ["favorites", "mistakes", "stubborn", "lookups"];

type WordbookViewProps = {
  activeTab: WordbookTab;
  favoriteWords: FavoriteWordItem[];
  mistakeWords: MistakeWordItem[];
  stubbornWordList: StubbornWordItem[];
  lookupWords: LookupWord[];
  ratingLabels: string[];
  clock: number;
  favorites: SavedWord[];
  onTabChange: (tab: WordbookTab) => void;
  onFocusWord: (word: Word) => void;
  onToggleFavorite: (word: Word) => void;
  onResolveMistake: (wordId: number) => void;
  onStartFavorites: () => void;
  onStartMistakes: () => void;
  onStartStubborn: () => void;
  onStartLookups: (wordIds?: number[]) => void;
  onRemoveLookup: (word: LookupWord) => void;
  onNavigateLearn: () => void;
};

export default function WordbookView({
  activeTab,
  favoriteWords,
  mistakeWords,
  stubbornWordList,
  lookupWords,
  ratingLabels,
  clock,
  favorites,
  onTabChange,
  onFocusWord,
  onToggleFavorite,
  onResolveMistake,
  onStartFavorites,
  onStartMistakes,
  onStartStubborn,
  onStartLookups,
  onRemoveLookup,
  onNavigateLearn,
}: WordbookViewProps) {
  const now = new Date(clock);
  const batchAction = {
    favorites: {
      label: "复习全部收藏",
      disabled: favoriteWords.length === 0,
      run: onStartFavorites,
    },
    mistakes: {
      label: "强化当前错词",
      disabled: mistakeWords.length === 0,
      run: onStartMistakes,
    },
    stubborn: {
      label: "开始顽固词专项",
      disabled: stubbornWordList.length === 0,
      run: onStartStubborn,
    },
    lookups: {
      label: "学习划词集",
      disabled: lookupWords.length === 0,
      run: () => onStartLookups(),
    },
  }[activeTab];
  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = WORDBOOK_TABS.indexOf(activeTab);
    const nextTab = event.key === "Home"
      ? WORDBOOK_TABS[0]
      : event.key === "End"
        ? WORDBOOK_TABS.at(-1)!
        : WORDBOOK_TABS[
            (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + WORDBOOK_TABS.length)
            % WORDBOOK_TABS.length
          ];
    onTabChange(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`wordbook-tab-${nextTab}`)?.focus();
    });
  };

  return (
    <div className="content-view">
      <div className="section-heading wordbook-heading">
        <div>
          <p className="eyebrow">PERSONAL WORD LEDGER</p>
          <h1>把难词留在手边</h1>
        </div>
        <div className="wordbook-counts">
          <span><strong>{favoriteWords.length}</strong> 个收藏</span>
          <span><strong>{mistakeWords.length}</strong> 个错词</span>
          <span><strong>{stubbornWordList.length}</strong> 个顽固词</span>
          <span><strong>{lookupWords.length}</strong> 个划词</span>
        </div>
        <div className="wordbook-batch-actions">
          <button onClick={batchAction.run} disabled={batchAction.disabled}>
            {batchAction.label}
          </button>
        </div>
      </div>
      <div
        className="wordbook-tabs"
        role="tablist"
        aria-label="词本分类"
        onKeyDown={moveTabFocus}
      >
        <button
          role="tab"
          id="wordbook-tab-favorites"
          aria-controls="wordbook-panel"
          aria-selected={activeTab === "favorites"}
          tabIndex={activeTab === "favorites" ? 0 : -1}
          className={activeTab === "favorites" ? "active" : ""}
          onClick={() => onTabChange("favorites")}
        >
          我的词本 <span>{favoriteWords.length}</span>
        </button>
        <button
          role="tab"
          id="wordbook-tab-mistakes"
          aria-controls="wordbook-panel"
          aria-selected={activeTab === "mistakes"}
          tabIndex={activeTab === "mistakes" ? 0 : -1}
          className={activeTab === "mistakes" ? "active" : ""}
          onClick={() => onTabChange("mistakes")}
        >
          错词记录 <span>{mistakeWords.length}</span>
        </button>
        <button
          role="tab"
          id="wordbook-tab-stubborn"
          aria-controls="wordbook-panel"
          aria-selected={activeTab === "stubborn"}
          tabIndex={activeTab === "stubborn" ? 0 : -1}
          className={activeTab === "stubborn" ? "active" : ""}
          onClick={() => onTabChange("stubborn")}
        >
          顽固词 <span>{stubbornWordList.length}</span>
        </button>
        <button
          role="tab"
          id="wordbook-tab-lookups"
          aria-controls="wordbook-panel"
          aria-selected={activeTab === "lookups"}
          tabIndex={activeTab === "lookups" ? 0 : -1}
          className={activeTab === "lookups" ? "active" : ""}
          onClick={() => onTabChange("lookups")}
        >
          划词集 <span>{lookupWords.length}</span>
        </button>
      </div>
      <div
        className="saved-word-grid"
        id="wordbook-panel"
        role="tabpanel"
        aria-labelledby={`wordbook-tab-${activeTab}`}
      >
        {activeTab === "favorites" && favoriteWords.map((item) => (
          <article className="saved-word-card" key={item.wordId}>
            <div className="saved-word-mark">{item.word.word.slice(0, 1).toUpperCase()}</div>
            <div className="saved-word-copy">
              <div><h2>{item.word.word}</h2><span>{item.word.phonetic ?? item.word.part ?? splitMeaning(item.word.meaning).part}</span></div>
              <p>{splitMeaning(item.word.meaning).meaning}</p>
              <small>{item.word.section ?? "红宝书"} · Unit {item.word.unit ?? "—"}</small>
            </div>
            <div className="saved-word-actions">
              <button onClick={() => onFocusWord(item.word)}>去复习</button>
              <button className="quiet" onClick={() => onToggleFavorite(item.word)}>移除</button>
            </div>
          </article>
        ))}
        {activeTab === "mistakes" && mistakeWords.map((item) => (
          <article className="saved-word-card mistake-card" key={item.wordId}>
            <div className="saved-word-mark">{item.mistakeCount}</div>
            <div className="saved-word-copy">
              <div><h2>{item.word.word}</h2><span>{ratingLabels[item.lastRating]}</span></div>
              <p>{splitMeaning(item.word.meaning).meaning}</p>
              <small>累计失误 {item.mistakeCount} 次 · {item.word.section ?? "红宝书"} Unit {item.word.unit ?? "—"}</small>
            </div>
            <div className="saved-word-actions">
              <button onClick={() => onFocusWord(item.word)}>重新学习</button>
              <button
                className={favorites.some((favorite) => favorite.wordId === item.wordId) ? "quiet saved" : "quiet"}
                onClick={() => onToggleFavorite(item.word)}
              >
                {favorites.some((favorite) => favorite.wordId === item.wordId) ? "已收藏" : "加入词本"}
              </button>
              <button className="quiet" onClick={() => onResolveMistake(item.wordId)}>已掌握</button>
            </div>
          </article>
        ))}
        {activeTab === "stubborn" && stubbornWordList.map((item) => (
          <article className="saved-word-card mistake-card" key={item.record.wordId}>
            <div className="saved-word-mark">{item.record.triggerCount}</div>
            <div className="saved-word-copy">
              <div>
                <h2>{item.word.word}</h2>
                <span>{item.record.reason === "again-3" ? "30 天内忘记 ≥ 3 次" : "30 天内低评分 ≥ 5 次"}</span>
              </div>
              <p>{splitMeaning(item.word.meaning).meaning}</p>
              <small>
                当前 R {item.progress ? wordRetrievability(item.progress, now) : 0}%
                {" · "}连续 3 次“认识/熟练”后自动退出
              </small>
            </div>
            <div className="saved-word-actions">
              <button onClick={() => onFocusWord(item.word)}>专项修复</button>
              <button
                className={favorites.some((favorite) => favorite.wordId === item.record.wordId) ? "quiet saved" : "quiet"}
                onClick={() => onToggleFavorite(item.word)}
              >
                {favorites.some((favorite) => favorite.wordId === item.record.wordId) ? "已收藏" : "加入词本"}
              </button>
            </div>
          </article>
        ))}
        {activeTab === "lookups" && lookupWords.map((item) => (
          <article
            className="saved-word-card lookup-word-card"
            key={item.linkedWordId === undefined
              ? `lookup:${item.query.toLowerCase()}`
              : `redbook:${item.linkedWordId}`}
          >
            <div className="saved-word-mark">↳</div>
            <div className="saved-word-copy">
              <div>
                <h2>{item.query}</h2>
                <span>{item.phonetic || item.part}</span>
              </div>
              <p>{item.meaning}</p>
              <small>
                {item.part}
                {item.note ? ` · ${item.note}` : ""}
                {" · "}{item.source === "redbook"
                  ? "红宝书"
                  : item.source === "dictionary"
                    ? "ECDICT 本地辞典"
                    : "DS Flash"}
              </small>
            </div>
            <div className="saved-word-actions">
              <button onClick={() => onStartLookups([item.linkedWordId ?? item.id])}>去学习</button>
              <button
                className="quiet"
                onClick={() => onRemoveLookup(item)}
              >
                移除
              </button>
            </div>
          </article>
        ))}
        {activeTab === "favorites" && favoriteWords.length === 0 && (
          <div className="wordbook-empty">
            <span>◇</span>
            <h2>词本还是空的</h2>
            <p>学习时点击单词卡右上角的菱形，即可收藏。</p>
            <button onClick={onNavigateLearn}>去学习</button>
          </div>
        )}
        {activeTab === "mistakes" && mistakeWords.length === 0 && (
          <div className="wordbook-empty">
            <span>✓</span>
            <h2>暂时没有错词</h2>
            <p>评分为“忘记”或“模糊”的单词会自动记录在这里。</p>
            <button onClick={onNavigateLearn}>继续学习</button>
          </div>
        )}
        {activeTab === "stubborn" && stubbornWordList.length === 0 && (
          <div className="wordbook-empty">
            <span>✓</span>
            <h2>没有活跃顽固词</h2>
            <p>连续成功 3 次或 30 天没有新的低评分会自动退出专项。</p>
            <button onClick={onNavigateLearn}>继续学习</button>
          </div>
        )}
        {activeTab === "lookups" && lookupWords.length === 0 && (
          <div className="wordbook-empty">
            <span>↳</span>
            <h2>还没有划词记录</h2>
            <p>在学习卡正文中划选英文，点击“翻译”后会自动收进这里。</p>
            <button onClick={onNavigateLearn}>去划词</button>
          </div>
        )}
      </div>
    </div>
  );
}
