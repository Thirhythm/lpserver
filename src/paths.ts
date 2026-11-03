import path from "node:path";

export function normalizeOpenlistPath(raw: string): string {
  const trimmed = raw.trim().replaceAll("\\", "/");
  if (trimmed === "") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const parts = withLeading.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.includes("..")) {
    throw new Error(`invalid OpenList path: ${raw}`);
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function joinOpenlistPath(basePath: string, relativePath: string): string {
  const base = normalizeOpenlistPath(basePath);
  const relative = normalizeOpenlistPath(relativePath);
  if (base === "/") return relative;
  if (relative === "/") return base;
  return `${base}${relative}`;
}

export function stripOpenlistBasePath(basePath: string, openlistPath: string): string {
  const base = normalizeOpenlistPath(basePath);
  const full = normalizeOpenlistPath(openlistPath);
  if (base === "/") return full;
  if (full === base) return "/";
  if (!full.startsWith(`${base}/`)) {
    throw new Error(`path ${full} is outside OpenList mount ${base}`);
  }
  return full.slice(base.length);
}

export function displayOpenlistPath(openlistPath: string): string {
  return normalizeOpenlistPath(openlistPath).replace(/^\/+/, "");
}

export function resolveLocalPath(localRoot: string, basePath: string, openlistPath: string): string {
  const root = path.resolve(localRoot);
  const relative = stripOpenlistBasePath(basePath, openlistPath);
  const parts = relative.split("/").filter(Boolean);
  const resolved = path.resolve(root, ...parts);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing to access path outside ${root}: ${openlistPath}`);
  }
  return resolved;
}

export function encodeOpenlistPath(openlistPath: string): string {
  return normalizeOpenlistPath(openlistPath)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildDownloadUrl(siteUrl: string, openlistPath: string, sign?: string | null): string {
  const base = siteUrl.trim().replace(/\/+$/, "");
  if (base === "") throw new Error("download site URL is empty");
  const url = new URL(`${base}/d/${encodeOpenlistPath(openlistPath)}`);
  if (sign) url.searchParams.set("sign", sign);
  return url.toString();
}
