const DEFAULT_SITE_URL = "http://localhost:3000";

function normalizeSiteUrl(input?: string | null): string {
  const raw = String(input || "").trim();
  if (!raw) return DEFAULT_SITE_URL;

  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function getSiteUrl(): string {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.NEXTAUTH_URL);
}

export function toAbsoluteUrl(pathname = "/"): string {
  return new URL(pathname, `${getSiteUrl()}/`).toString();
}
