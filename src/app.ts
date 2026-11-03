import Fastify, { type FastifyInstance } from "fastify";
import { createApiKeyGuard } from "./auth.js";
import type { Config } from "./config.js";
import { ModuleError, resolveModule } from "./modules.js";
import { OpenListError, type OpenListApi } from "./openlist.js";
import { buildDownloadUrl, displayOpenlistPath, joinOpenlistPath } from "./paths.js";
import { HashComputationError, type Sha256Service } from "./sha256.js";

export interface AppDependencies {
  config: Config;
  openlist: OpenListApi;
  sha256: Sha256Service;
}

interface ModuleQuery {
  module?: unknown;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, openlist, sha256 } = dependencies;
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: ['req.headers.authorization', 'req.headers["x-api-key"]'],
        censor: "[REDACTED]",
      },
    },
    trustProxy: true,
    requestTimeout: 0,
  });

  const guard = createApiKeyGuard(config.apiKey);

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/api/download", { preHandler: guard }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const module = resolveModule(
      (request.query as ModuleQuery).module,
      config.openlist.basePath,
    );

    const [files, siteUrl] = await Promise.all([
      openlist.listFiles(module.openlistPath),
      openlist.getSiteUrl(),
    ]);

    const items = files
      .filter((file) => !file.is_dir)
      .map((file) => {
        const fullPath = joinOpenlistPath(module.openlistPath, file.name);
        return {
          name: file.name,
          path: displayOpenlistPath(fullPath),
          size: file.size,
          modified: file.modified ?? "",
          url: buildDownloadUrl(siteUrl, fullPath, file.sign),
        };
      })
      .sort(compareByName);

    return { module: module.name, files: items };
  });

  app.get("/api/sha256", { preHandler: guard }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const module = resolveModule(
      (request.query as ModuleQuery).module,
      config.openlist.basePath,
    );

    const files = (await openlist.listFiles(module.openlistPath)).filter(
      (file) => !file.is_dir,
    );
    const inputs = files.map((file) => ({
      path: joinOpenlistPath(module.openlistPath, file.name),
      file,
    }));

    const hashes = await sha256.getHashes(inputs);
    try {
      await sha256.finalize(
        module.openlistPath,
        inputs.map((input) => input.path),
      );
    } catch (error) {
      request.log.warn({ err: error }, "failed to persist SHA256 cache");
    }

    const items = inputs
      .map(({ path, file }) => ({
        name: file.name,
        path: displayOpenlistPath(path),
        size: file.size,
        modified: file.modified ?? "",
        sha256: hashes.get(path) ?? "",
      }))
      .sort(compareByName);

    return { module: module.name, files: items };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ModuleError) {
      return reply.code(400).send({ error: "invalid_module", message: error.message });
    }
    if (error instanceof OpenListError) {
      const notFound = error.status === 404;
      return reply.code(notFound ? 404 : 502).send({
        error: notFound ? "not_found" : "openlist_error",
        message: error.message,
      });
    }
    if (error instanceof HashComputationError) {
      request.log.error({ err: error }, "SHA256 computation failed");
      return reply.code(502).send({ error: "hash_failed", message: error.message });
    }

    request.log.error({ err: error }, "unhandled request error");
    return reply
      .code(500)
      .send({ error: "internal_error", message: "internal server error" });
  });

  return app;
}

function compareByName<T extends { name: string }>(left: T, right: T): number {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}
