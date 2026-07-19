export interface DateRange {
  min?: string;
  max?: string;
}

export const LISTED_DAY_OPTIONS = [1, 3, 7, 14, 30, 90] as const;
export type ListedDays = (typeof LISTED_DAY_OPTIONS)[number];

export function isListedDays(value: number): value is ListedDays {
  return (LISTED_DAY_OPTIONS as readonly number[]).includes(value);
}

export function recentListedRange(days: ListedDays, now: Date = new Date()): Required<DateRange> {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { min: start.toISOString(), max: end.toISOString() };
}
