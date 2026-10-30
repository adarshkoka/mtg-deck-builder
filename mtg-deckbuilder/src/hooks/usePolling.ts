import { useEffect, useState } from 'react';

// Repeatedly calls `fetcher` until `isDone(result)` is true, then stops.
//
// Background jobs (imports, AI deck builds) run on the server for seconds or minutes, so
// the UI asks "how is it going?" every `intervalMs` and re-renders with the latest answer.
// Pass `null` as the fetcher to stop polling. Wrap the fetcher in useCallback, because a
// new function identity restarts the polling.
export function usePolling<T>(
  fetcher: (() => Promise<T>) | null,
  isDone: (value: T) => boolean,
  intervalMs = 1500,
): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!fetcher) return;

    let cancelled = false; // set when the component unmounts or the fetcher changes
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const value = await fetcher();
        if (cancelled) return;
        setData(value);
        if (!isDone(value)) timer = setTimeout(tick, intervalMs);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // isDone is a plain predicate; restarting only when the fetcher changes is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, intervalMs]);

  return { data, error };
}
