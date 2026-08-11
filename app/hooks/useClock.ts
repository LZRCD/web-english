import { useCallback, useEffect, useState } from "react";

/** 每分钟更新一次的时间戳，供需要时间感知的组件使用 */
export function useClock(): { clock: number; refreshClock: () => void } {
  const [clock, setClock] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    const refresh = () => setClock(Date.now());
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  const refreshClock = useCallback(() => setClock(Date.now()), []);

  return { clock, refreshClock };
}
