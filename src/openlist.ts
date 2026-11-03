export interface OpenListFileObject {
  name: string;
  size: number;
  is_dir: boolean;
  modified?: string;
  created?: string;
  sign?: string;
  type?: number;
  hash_info?: Record<string, string> | null;
  hashinfo?: string | null;
}

export interface OpenListApi {
  listFiles(openlistPath: string): Promise<OpenListFileObject[]>;
  getSiteUrl(): Promise<string>;
}

export class OpenListError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstreamCode?: number,
  ) {
    super(message);
    this.name = "OpenListError";
  }
}

export interface OpenListClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  timeoutMs: number;
  publicUrl?: string;
}

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export class OpenListClient implements OpenListApi {
  private token?: string;
  private loginPromise?: Promise<string>;
  private siteUrlCache?: { value: string; expiresAt: number };

  constructor(
    private readonly options: OpenListClientOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.token = options.token;
  }

  async listFiles(openlistPath: string): Promise<OpenListFileObject[]> {
    const files: OpenListFileObject[] = [];
    const perPage = 100;
    for (let page = 1; page <= 1000; page += 1) {
      const data = await this.request<{ content?: OpenListFileObject[]; total?: number }>(
        "/api/fs/list",
        {
          path: openlistPath,
          password: "",
          page,
          per_page: perPage,
          refresh: false,
        },
      );
      const content = Array.isArray(data?.content) ? data.content : [];
      files.push(...content);
      const total = typeof data?.total === "number" ? data.total : files.length;
      if (content.length < perPage || files.length >= total) break;
    }
    return files;
  }

  async getSiteUrl(): Promise<string> {
    if (this.options.publicUrl) return this.options.publicUrl;
    const now = Date.now();
    if (this.siteUrlCache && this.siteUrlCache.expiresAt > now) {
      return this.siteUrlCache.value;
    }

    let value = this.options.baseUrl;
    try {
      const settings = await this.request<Record<string, unknown>>(
        "/api/public/settings",
        undefined,
        false,
      );
      const configured = settings?.site_url;
      if (typeof configured === "string" && configured.trim() !== "") {
        value = configured.trim().replace(/\/+$/, "");
      }
    } catch {
      value = this.options.baseUrl;
    }

    this.siteUrlCache = { value, expiresAt: now + 5 * 60_000 };
    return value;
  }

  private canLogin(): boolean {
    return Boolean(this.options.username && this.options.password);
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.login();
  }

  private async login(): Promise<string> {
    if (this.loginPromise) return this.loginPromise;
    if (!this.canLogin()) {
      throw new OpenListError(
        "OpenList token is missing or invalid and no username/password is configured",
        502,
      );
    }

    this.loginPromise = (async () => {
      const data = await this.request<{ token?: string }>(
        "/api/auth/login",
        { username: this.options.username, password: this.options.password },
        false,
      );
      if (typeof data?.token !== "string" || data.token === "") {
        throw new OpenListError("OpenList login did not return a token", 502);
      }
      this.token = data.token;
      return data.token;
    })();

    try {
      return await this.loginPromise;
    } finally {
      this.loginPromise = undefined;
    }
  }

  private async request<T>(
    path: string,
    body?: unknown,
    auth = true,
    retry = true,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = await this.ensureToken();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new OpenListError(`cannot reach OpenList: ${reason}`, 502);
    }

    const raw = await response.text();
    let payload: Envelope<T> | null = null;
    if (raw.trim() !== "") {
      try {
        payload = JSON.parse(raw) as Envelope<T>;
      } catch {
        throw new OpenListError(
          `OpenList returned invalid JSON (HTTP ${response.status})`,
          502,
        );
      }
    }

    const unauthorized = response.status === 401 || payload?.code === 401;
    if (auth && retry && unauthorized && this.canLogin()) {
      this.token = undefined;
      await this.login();
      return this.request<T>(path, body, auth, false);
    }

    const code = typeof payload?.code === "number" ? payload.code : response.status;
    if (!response.ok || code !== 200) {
      const message =
        typeof payload?.message === "string" && payload.message !== ""
          ? payload.message
          : `HTTP ${response.status}`;
      const status = response.status === 404 || code === 404 ? 404 : 502;
      throw new OpenListError(`OpenList rejected ${path}: ${message}`, status, code);
    }

    return payload?.data as T;
  }
}
