import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "./db";

// Scopes minimum pour éditer Calendar principal
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

export function googleAuthUrl(state = "state") {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    scope?: string;
    token_type?: string;
    expires_in?: number;
  }>;
}

export async function refreshAccessToken(refresh_token: string) {
  const body = new URLSearchParams({
    refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google refresh error ${res.status}`);
  return res.json() as Promise<{
    access_token: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  }>;
}

export async function upsertGoogleTokens(
  userId: number,
  tok: {
    access_token: string;
    refresh_token: string;
    scope?: string;
    token_type?: string;
    expires_in?: number;
  }
) {
  const pool = getPool();
  const expiry = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;
  await pool.query(
    `INSERT INTO calendar_google_tokens (user_id, access_token, refresh_token, scope, token_type, expiry_date)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE access_token=VALUES(access_token), refresh_token=VALUES(refresh_token),
         scope=VALUES(scope), token_type=VALUES(token_type), expiry_date=VALUES(expiry_date)`,
    [userId, tok.access_token, tok.refresh_token, tok.scope || null, tok.token_type || null, expiry]
  );
}

// Typage strict pour la ligne renvoyée par MySQL
interface GoogleTokenRow extends RowDataPacket {
  access_token: string;
  refresh_token: string;
  expiry_date: Date | string | null;
}

export async function getValidAccessToken(userId: number): Promise<string | null> {
  const pool = getPool();

  const [rows] = await pool.query<GoogleTokenRow[]>(
    "SELECT access_token, refresh_token, expiry_date FROM calendar_google_tokens WHERE user_id=? LIMIT 1",
    [userId]
  );

  if (!rows.length) return null;

  const row = rows[0];
  const expiryMs =
    row.expiry_date ? new Date(row.expiry_date as unknown as string).getTime() : 0;

  // encore valide avec marge de 60s
  if (Date.now() < expiryMs - 60_000) return row.access_token;

  // refresh
  try {
    const fres = await refreshAccessToken(row.refresh_token);
    const newExpiry = fres.expires_in ? new Date(Date.now() + fres.expires_in * 1000) : null;
    await pool.query(
      "UPDATE calendar_google_tokens SET access_token=?, scope=?, token_type=?, expiry_date=? WHERE user_id=?",
      [fres.access_token, fres.scope || null, fres.token_type || null, newExpiry, userId]
    );
    return fres.access_token;
  } catch {
    return null;
  }
}

type UpsertGoogleEventInput = {
  title: string;
  description?: string | null;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  allDay?: boolean;
  timezone?: string;
};

export async function googleUpsertEvent(params: {
  userId: number;
  googleEventId?: string | null;
  event: UpsertGoogleEventInput;
}): Promise<{ googleEventId?: string | null }> {
  const access = await getValidAccessToken(params.userId);
  if (!access) return { googleEventId: undefined }; // pas connecté

  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };

  const body = {
    summary: params.event.title,
    description: params.event.description || undefined,
    start: params.event.allDay
      ? { date: params.event.start.slice(0, 10) }
      : { dateTime: params.event.start, timeZone: params.event.timezone || "UTC" },
    end: params.event.allDay
      ? { date: params.event.end.slice(0, 10) }
      : { dateTime: params.event.end, timeZone: params.event.timezone || "UTC" },
  };

  if (params.googleEventId) {
    const res = await fetch(`${base}/${encodeURIComponent(params.googleEventId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return { googleEventId: params.googleEventId }; // best-effort
    const j = (await res.json()) as { id: string };
    return { googleEventId: j.id };
  } else {
    const res = await fetch(base, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) return { googleEventId: undefined };
    const j = (await res.json()) as { id: string };
    return { googleEventId: j.id };
  }
}
