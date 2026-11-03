import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { OpenListClient, OpenListError } from "../src/openlist.js";

interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
): Promise<RunningServer> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    handler(request, response, Buffer.concat(chunks).toString("utf8"));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

test("listFiles paginates, authenticates and reads site_url", async (t) => {
  let loginCalls = 0;
  let listCalls = 0;
  const server = await startServer((request, response, body) => {
    if (request.url === "/api/auth/login") {
      loginCalls += 1;
      const payload = JSON.parse(body) as { username: string; password: string };
      assert.equal(payload.username, "admin");
      assert.equal(payload.password, "secret");
      json(response, 200, { code: 200, message: "success", data: { token: "token-1" } });
      return;
    }

    if (request.url === "/api/public/settings") {
      json(response, 200, {
        code: 200,
        message: "success",
        data: { site_url: "https://pan.example.com/" },
      });
      return;
    }

    if (request.url === "/api/fs/list") {
      listCalls += 1;
      assert.equal(request.headers.authorization, "token-1");
      const payload = JSON.parse(body) as { path: string; page: number; per_page: number };
      assert.equal(payload.path, "/SongPackages/Sympathy");
      assert.equal(payload.per_page, 100);
      if (payload.page === 1) {
        const content = Array.from({ length: 100 }, (_, index) => ({
          name: `f${index}.zip`,
          size: 1,
          is_dir: false,
          modified: "2026-01-01T00:00:00Z",
        }));
        json(response, 200, {
          code: 200,
          message: "success",
          data: { content, total: 101 },
        });
      } else {
        json(response, 200, {
          code: 200,
          message: "success",
          data: {
            content: [{ name: "last.zip", size: 1, is_dir: false }],
            total: 101,
          },
        });
      }
      return;
    }

    json(response, 404, { code: 404, message: "not found" });
  });
  t.after(() => server.close());

  const client = new OpenListClient({
    baseUrl: server.baseUrl,
    username: "admin",
    password: "secret",
    timeoutMs: 5000,
  });

  const files = await client.listFiles("/SongPackages/Sympathy");
  assert.equal(files.length, 101);
  assert.equal(files[100]?.name, "last.zip");
  assert.equal(listCalls, 2);
  assert.equal(loginCalls, 1);
  assert.equal(await client.getSiteUrl(), "https://pan.example.com");
});

test("listFiles re-logs in when the token expires", async (t) => {
  let logins = 0;
  let lists = 0;
  const server = await startServer((request, response) => {
    if (request.url === "/api/auth/login") {
      logins += 1;
      json(response, 200, {
        code: 200,
        message: "success",
        data: { token: logins === 1 ? "token-1" : "token-2" },
      });
      return;
    }

    if (request.url === "/api/fs/list") {
      lists += 1;
      if (request.headers.authorization === "token-1") {
        json(response, 401, { code: 401, message: "token expired" });
        return;
      }
      assert.equal(request.headers.authorization, "token-2");
      json(response, 200, {
        code: 200,
        message: "success",
        data: { content: [{ name: "a.zip", size: 3, is_dir: false }], total: 1 },
      });
      return;
    }

    json(response, 404, { code: 404, message: "not found" });
  });
  t.after(() => server.close());

  const client = new OpenListClient({
    baseUrl: server.baseUrl,
    username: "admin",
    password: "secret",
    timeoutMs: 5000,
  });

  const files = await client.listFiles("/SongPackages/Sympathy");
  assert.equal(files.length, 1);
  assert.equal(logins, 2);
  assert.equal(lists, 2);
});

test("static token is used without login and an expired token maps to 502", async (t) => {
  let loginCalls = 0;
  const server = await startServer((request, response) => {
    if (request.url === "/api/auth/login") {
      loginCalls += 1;
      json(response, 200, { code: 200, message: "success", data: { token: "new" } });
      return;
    }
    assert.equal(request.headers.authorization, "static-token");
    json(response, 401, { code: 401, message: "token expired" });
  });
  t.after(() => server.close());

  const client = new OpenListClient({
    baseUrl: server.baseUrl,
    token: "static-token",
    timeoutMs: 5000,
  });

  await assert.rejects(
    () => client.listFiles("/SongPackages/Sympathy"),
    (error: unknown) =>
      error instanceof OpenListError &&
      error.status === 502 &&
      /token expired/.test(error.message),
  );
  assert.equal(loginCalls, 0);
});

test("missing OpenList path maps to 404", async (t) => {
  const server = await startServer((request, response) => {
    if (request.url === "/api/auth/login") {
      json(response, 200, { code: 200, message: "success", data: { token: "token" } });
      return;
    }
    json(response, 404, { code: 404, message: "object not found" });
  });
  t.after(() => server.close());

  const client = new OpenListClient({
    baseUrl: server.baseUrl,
    username: "admin",
    password: "secret",
    timeoutMs: 5000,
  });

  await assert.rejects(
    () => client.listFiles("/missing"),
    (error: unknown) => error instanceof OpenListError && error.status === 404,
  );
});
