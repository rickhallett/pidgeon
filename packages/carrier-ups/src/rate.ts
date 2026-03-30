import { RateRequestSchema, httpRequest } from "@pidgeon/core";
import type { CarrierProvider, CarrierResult, Logger, RateRequest, RateQuote, FetchFn } from "@pidgeon/core";
import { upsError } from "./types.js";
import type { UpsCredentials, UpsRateProviderConfig } from "./types.js";
import { UpsTokenManager } from "./auth.js";
import { buildUpsRateRequest } from "./request-builder.js";
import { upsErrorBodyParser, parseUpsRateResponse } from "./response-parser.js";

export type { FetchFn } from "@pidgeon/core";

export class UpsRateProvider {
  private readonly fetchFn: FetchFn;
  private readonly credentials: UpsCredentials;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly ratingUrl: string;
  private readonly logger: Logger | undefined;
  private readonly tokenManager: UpsTokenManager;

  constructor(config: UpsRateProviderConfig) {
    this.fetchFn = config.fetch;
    this.credentials = config.credentials;
    this.maxAttempts = config.retry?.maxAttempts ?? 4;
    this.baseDelayMs = config.retry?.baseDelayMs ?? 200;
    this.timeoutMs = config.retry?.timeoutMs ?? 3_000;
    this.maxRetryAfterSeconds = config.retry?.maxRetryAfterSeconds ?? 5;
    this.ratingUrl = config.urls?.rating ?? "https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit";
    this.logger = config.logger;
    this.tokenManager = new UpsTokenManager({
      fetchFn: config.fetch,
      tokenUrl: config.urls?.token ?? "https://onlinetools.ups.com/security/v1/oauth/token",
      clientId: config.credentials.clientId,
      clientSecret: config.credentials.clientSecret,
      timeoutMs: this.timeoutMs,
      tokenExpiryBufferSeconds: config.tokenExpiryBufferSeconds ?? 60,
      ...(config.logger !== undefined ? { logger: config.logger } : {}),
    });
  }

  async getRates(request: RateRequest): Promise<CarrierResult<RateQuote[]>> {
    const validation = RateRequestSchema.safeParse(request);
    if (!validation.success) {
      const messages = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return { ok: false, error: upsError("VALIDATION", `Validation failed: ${messages.join("; ")}`) };
    }

    return this.executeWithToken(request, false);
  }

  private async executeWithToken(request: RateRequest, isAuthRetry: boolean): Promise<CarrierResult<RateQuote[]>> {
    const tokenResult = await this.tokenManager.getToken();
    if (!tokenResult.ok) return tokenResult;

    const requestBody = buildUpsRateRequest(request, this.credentials.accountNumber);

    const clientConfig: import("@pidgeon/core").HttpClientConfig = {
      fetch: this.fetchFn,
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      timeoutMs: this.timeoutMs,
      maxRetryAfterSeconds: this.maxRetryAfterSeconds,
      ...(this.logger !== undefined ? { logger: this.logger } : {}),
    };

    const result = await httpRequest(
      clientConfig,
      {
        url: this.ratingUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tokenResult.data}`,
        },
        body: JSON.stringify(requestBody),
        carrier: "UPS",
      },
      upsErrorBodyParser,
    );

    if (!result.ok) {
      if (result.error.code === "AUTH" && !isAuthRetry) {
        this.tokenManager.invalidate();
        return this.executeWithToken(request, true);
      }
      return result;
    }

    const mapped = parseUpsRateResponse(result.data.json);
    if (mapped.ok) {
      this.logger?.info("rating success", { quoteCount: mapped.data.length });
    }
    return mapped;
  }
}

// Compile-time check: UpsRateProvider structurally satisfies CarrierProvider
null! as UpsRateProvider satisfies CarrierProvider;
