// lib/recurrence.ts
export type RecurrenceInput = {
  frequency: "NONE" | "WEEKLY" | "MONTHLY";
  interval?: number; // nb semaines ou nb mois
  count?: number;    // nb d'occurrences
};

export function buildRRule(input?: RecurrenceInput | null): string | null {
  if (!input || input.frequency === "NONE") return null;
  const parts: string[] = [];
  parts.push(`FREQ=${input.frequency}`);
  if (input.interval && input.interval > 0) parts.push(`INTERVAL=${input.interval}`);
  if (input.count && input.count > 0) parts.push(`COUNT=${input.count}`);
  return parts.join(";");
}
