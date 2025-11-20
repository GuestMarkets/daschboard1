export type Company = "Guest Markets" | "Guest Cameroon" | "Other";

/** Déduit l'entreprise depuis le domaine email (même logique que tes vues SQL). */
export function companyFromEmail(email: string | null | undefined): Company {
  const e = (email || "").toLowerCase();
  if (!e.includes("@")) return "Other";
  if (e.includes("guestmarkets")) return "Guest Markets";
  if (e.includes("guestcameroon") || e.includes("guestcameroun")) return "Guest Cameroon";
  return "Other";
}

export const COMPANIES: Company[] = ["Guest Markets", "Guest Cameroon"];
