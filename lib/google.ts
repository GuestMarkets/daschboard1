// lib/google.ts
import { google } from "googleapis";

export type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number; // ms epoch
};

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env vars manquantes (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI).");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(state?: string) {
  const oauth2Client = getOAuthClient();
  const scopes = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "email",
    "profile",
    "openid",
  ];
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // pour forcer refresh_token la 1ère fois
    scope: scopes,
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens as GoogleTokens;
}
