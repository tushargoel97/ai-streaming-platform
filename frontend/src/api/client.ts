import { API_URL } from "@/lib/constants";

interface CacheEntry {
  data: unknown;
  expires: number;
}

class ApiClient {
  private baseUrl: string;
  private refreshing: Promise<boolean> | null = null;
  // In-flight GET deduplication
  private inFlight = new Map<string, Promise<unknown>>();
  // SWR-style cache for GET requests
  private cache = new Map<string, CacheEntry>();
  private defaultCacheTtl = 30_000; // 30s

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const token = localStorage.getItem("access_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  /** Try to refresh the access token. Returns true if successful. */
  private async tryRefresh(): Promise<boolean> {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const tokens = await res.json();
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  /** Deduplicated refresh — concurrent 401s share one refresh attempt. */
  private refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.tryRefresh().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async get<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const key = url.toString();

    // Return cached data if still fresh
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }

    // Deduplicate in-flight requests for the same URL
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = this._doGet<T>(key, signal);
    this.inFlight.set(key, promise);
    try {
      const result = await promise;
      // Cache the result
      this.cache.set(key, { data: result, expires: Date.now() + this.defaultCacheTtl });
      return result;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async _doGet<T>(url: string, signal?: AbortSignal): Promise<T> {
    let res = await fetch(url, { headers: this.getHeaders(), signal });
    if (res.status === 401 && await this.refresh()) {
      res = await fetch(url, { headers: this.getHeaders(), signal });
    }
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async post<T>(path: string, body?: unknown, timeoutMs = 12000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401 && await this.refresh()) {
        res = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: this.getHeaders(),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      }
      if (!res.ok) throw new ApiError(res.status, await res.text());
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401 && await this.refresh()) {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    }
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async delete(path: string, signal?: AbortSignal): Promise<void> {
    let res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.getHeaders(),
      signal,
    });
    if (res.status === 401 && await this.refresh()) {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "DELETE",
        headers: this.getHeaders(),
        signal,
      });
    }
    if (!res.ok) throw new ApiError(res.status, await res.text());
  }

  async upload<T>(path: string, formData: FormData): Promise<T> {
    const headers: HeadersInit = {};
    const token = localStorage.getItem("access_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API Error ${status}: ${body}`);
  }
}

export const api = new ApiClient(API_URL);
