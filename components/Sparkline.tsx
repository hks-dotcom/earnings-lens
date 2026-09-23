// 5-quarter trend line, oldest (left) to newest (right). `values` comes in
// newest-first (matching KeyFinancials), so it's reversed for display.
export function Sparkline({ values }: { values: (number | undefined)[] }) {
  const chrono = [...values].reverse(); // oldest -> newest
  const xs = [6, 28, 50, 72, 94];
  const defined = chrono.filter((v): v is number => v !== undefined);
  if (defined.length < 2) {
    return <svg width="100" height="28" viewBox="0 0 100 28" aria-hidden="true" />;
  }
  const min = Math.min(...defined);
  const max = Math.max(...defined);
  const span = max - min || 1;
  const ys = chrono.map((v) => (v === undefined ? undefined : 24 - ((v - min) / span) * 20));

  // Break the polyline into contiguous runs so a missing quarter leaves a gap, not a guessed connection.
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  ys.forEach((y, i) => {
    if (y === undefined) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push({ x: xs[i], y });
    }
  });
  if (current.length) runs.push(current);

  return (
    <svg width="100" height="28" viewBox="0 0 100 28" aria-hidden="true">
      {runs.map((run, i) => (
        <polyline
          key={i}
          points={run.map((p) => `${p.x},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="#1C1B19"
          strokeWidth="1.5"
        />
      ))}
      {ys.map((y, i) =>
        y === undefined ? null : <circle key={i} cx={xs[i]} cy={y} r="2.5" fill="#1C1B19" />
      )}
    </svg>
  );
}
