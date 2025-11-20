// lib/priority.ts
export type Priority = "low" | "medium" | "high";

/**
 * Montée auto de priorité selon le temps écoulé (entre created_at et due_datetime)
 *  - À 50% : low -> medium, medium -> high
 *  - À 70% : medium -> high (si pas déjà)
 * Ne baisse jamais la priorité.
 */
export function autoRaisePriority(
  currentPriority: Priority,
  createdAt: Date,
  dueAt: Date,
  now = new Date()
): Priority {
  const totalMs = Math.max(1, dueAt.getTime() - createdAt.getTime());
  const elapsedMs = Math.max(0, now.getTime() - createdAt.getTime());
  const pct = (elapsedMs / totalMs) * 100;

  let p: Priority = currentPriority;

  if (pct >= 50 && pct < 70) {
    if (p === "low") p = "medium";
    else if (p === "medium") p = "high";
  }
  if (pct >= 70) {
    if (p === "medium") p = "high";
  }
  return p;
}

export function autoPriorityWithProgress(
  currentPriority: Priority,
  createdAt: Date,
  dueAt: Date,
  progress: number,
  now = new Date()
): Priority {
  let p = autoRaisePriority(currentPriority, createdAt, dueAt, now);
  const totalMs = Math.max(1, dueAt.getTime() - createdAt.getTime());
  const elapsedMs = Math.max(0, now.getTime() - createdAt.getTime());
  const pct = (elapsedMs / totalMs) * 100;

  // Bonus : si >70% du temps et progression <30% → high
  if (pct >= 70 && progress < 30) p = "high";
  return p;
}
