import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HashCache } from "./hash.js";
import { OpenListClient } from "./openlist.js";
import { Sha256Service } from "./sha256.js";

const config = loadConfig();

const cache = new HashCache(config.hashCachePath);
await cache.load();

const openlist = new OpenListClient({
  baseUrl: config.openlist.baseUrl,
  username: config.openlist.username,
  password: config.openlist.password,
  token: config.openlist.token,
  timeoutMs: config.openlist.timeoutMs,
  publicUrl: config.openlist.publicUrl,
});

const sha256 = new Sha256Service({
  cache,
  localRoot: config.openlist.localRoot,
  basePath: config.openlist.basePath,
  concurrency: config.sha256Concurrency,
});

const app = await buildApp({ config, openlist, sha256 });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "failed to close HTTP server");
  }
  try {
    await cache.save();
  } catch (error) {
    app.log.error({ err: error }, "failed to save SHA256 cache");
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error({ err: error }, "failed to start server");
  process.exit(1);
}
