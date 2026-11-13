/**
 * The app's one duration format: 45 -> "45m", 60 -> "1h 00m", 375 -> "6h 15m".
 * Rounded to whole minutes first, so a fractional total never reads "1h 60m".
 */
export function formatDuration(totalMinutes: number): string {
  const total = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
