import path from "node:path";
import { normalizeOpenlistPath } from "./paths.js";

export interface OpenListConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  basePath: string;
  localRoot: string;
  timeoutMs: number;
  publicUrl?: string;
}

export interface Config {
  port: number;
  host: string;
  apiKey: string;
  openlist: OpenListConfig;
  hashCachePath: string;
  sha256Concurrency: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function httpUrl(raw: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return raw.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = required(env, "API_KEY");
  if (apiKey.length < 32) throw new Error("API_KEY must be at least 32 characters");

  const baseUrl = httpUrl(required(env, "OPENLIST_BASE_URL"), "OPENLIST_BASE_URL");
  const token = env.OPENLIST_TOKEN?.trim() || undefined;
  const username = env.OPENLIST_USERNAME?.trim() || undefined;
  const password = env.OPENLIST_PASSWORD || undefined;
  if (!token && (!username || !password)) {
    throw new Error("set OPENLIST_TOKEN or both OPENLIST_USERNAME and OPENLIST_PASSWORD");
  }

  const publicUrlRaw = env.OPENLIST_PUBLIC_URL?.trim();

  return {
    port: positiveInteger(env.PORT, 3000, "PORT"),
    host: env.HOST?.trim() || "127.0.0.1",
    apiKey,
    openlist: {
      baseUrl,
      username,
      password,
      token,
      basePath: normalizeOpenlistPath(env.OPENLIST_BASE_PATH ?? "/"),
      localRoot: path.resolve(env.OPENLIST_LOCAL_ROOT?.trim() || "/home/user000/openlist"),
      timeoutMs: positiveInteger(env.OPENLIST_TIMEOUT_MS, 15_000, "OPENLIST_TIMEOUT_MS"),
      publicUrl: publicUrlRaw ? httpUrl(publicUrlRaw, "OPENLIST_PUBLIC_URL") : undefined,
    },
    hashCachePath: path.resolve(env.HASH_CACHE_PATH?.trim() || "./data/hash-cache.json"),
    sha256Concurrency: positiveInteger(env.SHA256_CONCURRENCY, 2, "SHA256_CONCURRENCY"),
  };
}
