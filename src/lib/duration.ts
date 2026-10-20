/**
 * Elapsed time for AI runs, readable at a glance:
 * `42s` under a minute, `5m 30s` under an hour, `1h 5m 30s` beyond that.
 * The unit letters stay untranslated so the number and its unit are never
 * split across languages.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}
