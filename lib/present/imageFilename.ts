/**
 * "Filename: TICKER-Lens-Period-YYYY-MM-DD.png, e.g.
 * AMZN-NexCore-Q2FY26-2026-09-21.png" -- the lens as its display name
 * (LENS_NAME), since the file is for people.
 *
 * The trailing date is the day the image was taken, not the period end:
 * red flags run on a trailing-12-month window from today, so the same
 * ticker and quarter can produce a different board a month later, and the
 * filename has to tell those two files apart.
 */
export function lensImageFilename(
  ticker: string,
  lens: string,
  fiscalQuarterLabel: string,
  takenOn: Date = new Date()
): string {
  const period = fiscalQuarterLabel.replace(/\s+/g, "") || "NoPeriod";
  const y = takenOn.getFullYear();
  const m = String(takenOn.getMonth() + 1).padStart(2, "0");
  const d = String(takenOn.getDate()).padStart(2, "0");
  return `${ticker}-${lens}-${period}-${y}-${m}-${d}.png`;
}
