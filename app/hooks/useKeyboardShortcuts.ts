import { useEffect, useRef } from "react";

type ShortcutAction = () => void;

export type ShortcutConfig = {
  /** 按键匹配：Escape/Space/a/e/f/z//1/2/3/4 等 */
  key: string;
  /** 是否在聚焦元素内也触发（默认在 input/textarea/select/button/[contenteditable] 内时跳过） */
  allowInFormFields?: boolean;
  /** 仅在条件满足时触发 */
  when?: () => boolean;
  /** 是否需要 preventDefault */
  preventDefault?: boolean;
  action: ShortcutAction;
};

export type KeyboardShortcutsOptions = {
  shortcuts: ShortcutConfig[];
  /** 全局暂停条件（如弹层打开时） */
  paused?: () => boolean;
};

/** 元素是否处于可编辑状态 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
    || target.isContentEditable
    || target.closest('[contenteditable="true"]') !== null
    || target.closest('[role="textbox"]') !== null
    || target.closest('[role="searchbox"]') !== null
    || target.closest('[role="combobox"]') !== null
    || target.closest('button, a, summary, [role="button"], [role="link"]') !== null
  );
}

export function useKeyboardShortcuts({
  shortcuts,
  paused,
}: KeyboardShortcutsOptions) {
  const shortcutsRef = useRef(shortcuts);
  const pausedRef = useRef(paused);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
    pausedRef.current = paused;
  }, [paused, shortcuts]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape 始终优先处理
      if (event.key === "Escape") {
        const escapeAction = shortcutsRef.current.find((s) => s.key === "Escape")?.action;
        escapeAction?.();
        return;
      }

      // 暂停时跳过
      if (pausedRef.current?.()) return;

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.key === "Escape") continue; // Escape 已在上方处理

        const matchKey = shortcut.key === "Space"
          ? event.code === "Space"
          : event.key.toLowerCase() === shortcut.key.toLowerCase();

        if (!matchKey) continue;
        if (shortcut.when && !shortcut.when()) continue;
        if (!shortcut.allowInFormFields && isEditableTarget(event.target)) continue;
        if (shortcut.preventDefault !== false) event.preventDefault();

        shortcut.action();
        break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
