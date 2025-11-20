// lib/datetime.ts
export function toISODate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function combineDateTime(dateStr: string, timeStr?: string | null) {
  if (!timeStr) return new Date(`${dateStr}T00:00:00`);
  return new Date(`${dateStr}T${timeStr}:00`);
}

export function withinBusinessHours(time: string) {
  // créneau 07:30 → 19:00
  const [h, m] = time.split(":").map(Number);
  const min = 7 * 60 + 30;
  const max = 19 * 60;
  const val = h * 60 + m;
  return val >= min && val <= max;
}
