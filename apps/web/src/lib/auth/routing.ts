const PUBLIC_AUTH_PATHS = new Set([
  "/login",
  "/forgot-password",
  "/auth/update-password",
]);

function normalisePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function isPublicAppPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(normalisePathname(pathname));
}

export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
  ) {
    return "/";
  }

  try {
    const parsed = new URL(value, "https://bbx.local");
    if (parsed.origin !== "https://bbx.local") return "/";
    if (isPublicAppPath(parsed.pathname)) return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}
