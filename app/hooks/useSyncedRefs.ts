import { useLayoutEffect, useRef } from "react";

/** 将一组值自动同步到对应的 ref，用于键盘快捷键等需要读取最新值但不重注册的场景 */
type SyncedRefs<T extends Record<string, unknown>> = {
  [K in keyof T]: React.MutableRefObject<T[K]>;
};

export function useSyncedRefs<T extends Record<string, unknown>>(
  values: T,
): SyncedRefs<T> {
  const refsRef = useRef<SyncedRefs<T> | null>(null);

  // 首次渲染时惰性创建 ref 对象
  if (!refsRef.current) {
    const refs = {} as SyncedRefs<T>;
    for (const key of Object.keys(values) as (keyof T)[]) {
      (refs as Record<string, unknown>)[key as string] = {
        current: values[key],
      };
    }
    refsRef.current = refs;
  }

  // 每次渲染后同步所有 ref 值
  useLayoutEffect(() => {
    const refs = refsRef.current!;
    for (const key of Object.keys(values) as (keyof T)[]) {
      refs[key].current = values[key];
    }
  });

  return refsRef.current;
}
