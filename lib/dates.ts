// lib/dates.ts

// Calcule le nombre d'heures entre deux dates ISO
export function hoursBetween(aISO: string, bISO: string) {
  const ms = new Date(bISO).getTime() - new Date(aISO).getTime();
  return Math.max(0, Math.round(ms / 36e5)); // 36e5 = 3 600 000 (ms dans 1h)
}

// Retourne le pourcentage d'heures écoulées entre maintenant et l'heure de la réunion
export function progressFromTimes(nowISO: string, startISO: string) {
  const start = new Date(startISO).getTime();
  const now = new Date(nowISO).getTime();

  // Si la réunion est déjà passée, on renvoie 100%
  if (now >= start) return 100;

  // Durée totale entre now et le début de la réunion (en ms)
  const totalMs = start - now;

  // Temps écoulé depuis "maintenant" jusqu'à maintenant = 0 (mais fonction générique)
  const elapsedMs = Date.now() - now;

  // Pourcentage du temps écoulé vers l’échéance
  const pct = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
  return Math.round(pct);
}

export type Priority = "low" | "medium" | "high";

/**
 * Escalade automatique :
 * - 50% => low→medium, medium→high
 * - 70% => medium→high
 * - Jamais à la baisse
 */
export function autoPriority(base: Priority, pctElapsed: number): Priority {
  if (pctElapsed >= 70) return base === "medium" ? "high" : base;
  if (pctElapsed >= 50) {
    if (base === "low") return "medium";
    if (base === "medium") return "high";
  }
  return base;
}
