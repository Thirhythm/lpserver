import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export function createApiKeyGuard(apiKey: string) {
  const expected = Buffer.from(apiKey, "utf8");

  return async function apiKeyGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers["x-api-key"];
    let candidate: string | undefined;
    if (typeof header === "string") candidate = header;
    else if (Array.isArray(header)) candidate = header[0];

    if (!candidate) {
      const authorization = request.headers.authorization;
      if (typeof authorization === "string") {
        const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
        candidate = match?.[1]?.trim();
      }
    }

    if (!candidate || !safeEqual(candidate, expected)) {
      await reply
        .code(401)
        .header("WWW-Authenticate", 'Bearer realm="lpserver"')
        .send({ error: "unauthorized", message: "missing or invalid API key" });
    }
  };
}

function safeEqual(candidate: string, expected: Buffer): boolean {
  const actual = Buffer.from(candidate, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
