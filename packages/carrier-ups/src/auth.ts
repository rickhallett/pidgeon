import type { CarrierResult, FetchFn, Logger } from "@pidgeon/core";
import { upsError } from "./types.js";

export class UpsTokenManager {
  private readonly fetchFn: FetchFn;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly tokenExpiryBufferSeconds: number;
  private readonly logger: Logger | undefined;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(opts: {
    readonly fetchFn: FetchFn;
    readonly tokenUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly timeoutMs: number;
    readonly tokenExpiryBufferSeconds: number;
    readonly logger?: Logger;
  }) {
    this.fetchFn = opts.fetchFn;
    this.tokenUrl = opts.tokenUrl;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.timeoutMs = opts.timeoutMs;
    this.tokenExpiryBufferSeconds = opts.tokenExpiryBufferSeconds;
    this.logger = opts.logger;
  }

  async getToken(): Promise<CarrierResult<string>> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return { ok: true, data: this.cachedToken.accessToken };
    }
    return this.acquireToken();
  }

  invalidate(): void {
    this.cachedToken = null;
  }

  private async acquireToken(): Promise<CarrierResult<string>> {
    this.logger?.info("acquiring token");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, error: upsError("TIMEOUT", "token endpoint timeout", true) };
      }
      return { ok: false, error: upsError("AUTH", `token endpoint error: ${error instanceof Error ? error.message : String(error)}`) };
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { ok: false, error: upsError("AUTH", `UPS auth token error (${response.status})`) };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: upsError("AUTH", "Failed to parse token response as JSON") };
    }

    const body = json as Record<string, unknown>;
    const accessToken = body?.access_token;
    if (typeof accessToken !== "string") {
      return { ok: false, error: upsError("AUTH", "token response missing access_token") };
    }

    const rawExpiry = body.expires_in;
    const expiresIn = typeof rawExpiry === "number" ? rawExpiry : parseInt(String(rawExpiry), 10) || 0;
    this.cachedToken = {
      accessToken,
      expiresAt: Date.now() + Math.max(0, expiresIn - this.tokenExpiryBufferSeconds) * 1000,
    };
    this.logger?.info("token acquired", { expiresIn });

    return { ok: true, data: accessToken };
  }
}
