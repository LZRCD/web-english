import { useCallback, useEffect, useState } from "react";

/** 每分钟更新一次的时间戳，供需要时间感知的组件使用 */
export function useClock(): { clock: number; refreshClock: () => void } {
  const [clock, setClock] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const refreshClock = useCallback(() => setClock(Date.now()), []);

  return { clock, refreshClock };
}
