import { useCallback, useEffect, useRef, useState } from 'react';

// Fetch on mount and every `ms`. State only changes when the payload changes,
// so a refresh with identical data re-renders nothing and the map stays put.
export function useLoad(fn, deps = [], ms = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const last = useRef('');
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    try {
      const d = await fnRef.current();
      const s = JSON.stringify(d);
      if (s !== last.current) { last.current = s; setData(d); }
      setError(null);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => {
    last.current = '';
    setData(null);
    run();
    const t = ms ? setInterval(run, ms) : null;
    return () => t && clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload: run };
}
