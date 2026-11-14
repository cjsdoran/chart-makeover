import { useEffect, useState } from 'react';

/** "Daniel is reading your chart… 7 s" while a call runs (spec §1). */
export function Waiting({ label }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [label]);
  return (
    <p className="waiting" role="status" aria-live="polite">
      {label}… <span className="mono">{seconds} s</span>
    </p>
  );
}
