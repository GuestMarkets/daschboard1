// lib/calendar.ts

// Types JSON sûrs pour le champ "metadata"
type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

// Charge utile attendue par l'API calendar.zip
export type CalendarPayload = {
  id?: string;                       // si présent => update
  title: string;
  description?: string | null;
  start_at: string;                  // ISO
  end_at: string;                    // ISO
  location?: string | null;
  recurrence_rule?: string | null;   // ex: FREQ=WEEKLY;INTERVAL=1;COUNT=6
  metadata?: Record<string, JsonValue>; // ex: task_id, department_id, etc.
};

// Réponse standardisée de l'API
type ApiEventResponse = { id: string };

// Petit helper pour extraire un message d'erreur lisible
async function errorText(res: Response): Promise<string> {
  try {
    // On tente de lire un JSON d'erreur { message: string } sinon texte brut
    const data = (await res.json()) as { message?: string } | unknown;
    if (
      typeof data === "object" &&
      data &&
      "message" in data &&
      typeof (data as { message?: string }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
  } catch {
    // ignore JSON parse errors
  }
  try {
    return await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Adapter les URL ci-dessous à l'API fournie par calendar.zip.
 * Hypothèse:
 *  - POST /api/calendar/events        -> crée
 *  - PATCH /api/calendar/events/:id   -> met à jour
 */
export async function createOrUpdateCalendarEvent(
  payload: CalendarPayload
): Promise<{ id: string }> {
  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // UPDATE
  if (payload.id) {
    const res = await fetch(
      `/api/calendar/events/${encodeURIComponent(payload.id)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const msg = await errorText(res);
      throw new Error(`Calendar update failed (${res.status}): ${msg}`);
    }

    // On typage la réponse au format attendu
    const json = (await res.json()) as Partial<ApiEventResponse> | null;
    return { id: json && typeof json.id === "string" ? json.id : payload.id };
  }

  // CREATE
  // On évite d'envoyer "id" au POST si jamais présent par accident
  type NewEventPayload = Omit<CalendarPayload, "id">;
  const createBody = { ...payload } as NewEventPayload & { id?: string };
  delete createBody.id;

  const res = await fetch(`/api/calendar/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(createBody as NewEventPayload),
  });

  if (!res.ok) {
    const msg = await errorText(res);
    throw new Error(`Calendar create failed (${res.status}): ${msg}`);
  }

  const json = (await res.json()) as Partial<ApiEventResponse> | null;
  if (!json || typeof json.id !== "string") {
    throw new Error("Calendar create failed: missing 'id' in response");
  }

  return { id: json.id };
}
