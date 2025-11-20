// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session_token";
const PUBLIC_PATHS = [
  "/",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot",
  "/_next",
  "/favicon",
  "/images",
  "/public",
];

type Role = "user" | "manager" | "admin" | "superAdmin";
type Company = "guestmarkets" | "guestcameroon";

function getSecret() {
  const secret = process.env.JWT_SECRET || "dev-secret";
  return new TextEncoder().encode(secret);
}

function dashboardPath(company: Company, role: Role): string {
  const base = company === "guestmarkets" ? "/guestmarkets" : "/guestcameroon";
  switch (role) {
    case "superAdmin": return `${base}/super-admin/overview`;
    case "admin":      return `${base}/admin/overview`;
    case "manager":    return `${base}/managers/overview`;
    default:           return `${base}/users/overview`;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const company = (payload as any).company as Company | undefined;
    const role = (payload as any).role as Role | undefined;

    if (!company) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    // point d'entrée générique
    if (pathname === "/" || pathname === "/admin/overview") {
      const url = req.nextUrl.clone();
      url.pathname = dashboardPath(company, (role ?? "user") as Role);
      return NextResponse.redirect(url);
    }

    // Cloisonnement inter-entreprises
    if (pathname.startsWith("/guestmarkets") && company !== "guestmarkets") {
      const url = req.nextUrl.clone();
      url.pathname = dashboardPath(company, (role ?? "user") as Role);
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith("/guestcameroon") && company !== "guestcameroon") {
      const url = req.nextUrl.clone();
      url.pathname = dashboardPath(company, (role ?? "user") as Role);
      return NextResponse.redirect(url);
    }

    // Contrôle de rôle par section
    if (pathname.includes("/super-admin") && role !== "superAdmin") {
      const url = req.nextUrl.clone();
      url.pathname = dashboardPath(company, (role ?? "user") as Role);
      return NextResponse.redirect(url);
    }
    if (pathname.includes("/admin") && !(role === "admin" || role === "superAdmin")) {
      const url = req.nextUrl.clone();
      url.pathname = dashboardPath(company, (role ?? "user") as Role);
      return NextResponse.redirect(url);
    }
    if (pathname.includes("/managers") && !(role === "manager" || role === "admin" || role === "superAdmin")) {
      const url = req.nextUrl.clone();
      url.pathname = dashboardPath(company, (role ?? "user") as Role);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  } catch {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
