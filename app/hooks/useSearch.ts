import { Dispatch, SetStateAction, useEffect, useState } from "react";

/** 搜索面板 UI 状态 + 焦点陷阱 */
export function useSearch(): {
  searchOpen: boolean;
  searchQuery: string;
  selectedSearchIds: number[];
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setSelectedSearchIds: Dispatch<SetStateAction<number[]>>;
} {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchIds, setSelectedSearchIds] = useState<number[]>([]);

  // 搜索面板焦点陷阱 + 滚动锁定
  useEffect(() => {
    if (!searchOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = document.querySelector(".search-panel") as HTMLElement | null;
    if (!panel) {
      document.body.style.overflow = originalOverflow;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);

    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      previousFocus?.focus?.();
    };
  }, [searchOpen]);

  return {
    searchOpen,
    searchQuery,
    selectedSearchIds,
    setSearchOpen,
    setSearchQuery,
    setSelectedSearchIds,
  };
}
