import type { CarrierError, CarrierErrorCode, CarrierResult, Logger } from "./index.js";

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HttpClientConfig = {
  readonly fetch: FetchFn;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly timeoutMs?: number;
  readonly maxRetryAfterSeconds?: number;
  readonly logger?: Logger;
};

export type HttpRequestConfig = {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly carrier: string;
};

export type ErrorBodyParser = (status: number, body: unknown) => string | null;

type HttpSuccess = { readonly status: number; readonly json: unknown };

function carrierError(
  carrier: string,
  code: CarrierErrorCode,
  message: string,
  retriable = false,
): CarrierError {
  return { code, message, carrier, retriable };
}

function mapStatusToError(
  carrier: string,
  status: number,
  bodyMessage: string | null,
  errorBodyParser: ErrorBodyParser | undefined,
  rawBody: unknown,
): CarrierError {
  const parsed = errorBodyParser?.(status, rawBody) ?? null;
  const detail = parsed ?? bodyMessage;

  if (status === 401) {
    return carrierError(carrier, "AUTH", `${carrier} auth error (${status}): ${detail || "Unauthorized"}`);
  }
  if (status === 429) {
    return carrierError(carrier, "RATE_LIMIT", `${carrier} rate limit exceeded (${status}): ${detail || "Too many requests"}`, true);
  }
  if (status >= 500) {
    return carrierError(
      carrier,
      "PROVIDER",
      detail ? `${carrier} error (${status}): ${detail}` : `${carrier} HTTP error (${status})`,
      true,
    );
  }
  if (detail) {
    return carrierError(carrier, "PROVIDER", `${carrier} error (${status}): ${detail}`);
  }
  return carrierError(carrier, "PROVIDER", `${carrier} HTTP error (${status})`);
}

async function parseErrorBody(
  response: Response,
  logger: Logger | undefined,
): Promise<{ raw: unknown; message: string | null }> {
  let raw: unknown = "unparseable";
  let message: string | null = null;
  try {
    const body = await response.json();
    raw = body;
  } catch {
    // Body is not parseable JSON
  }
  logger?.debug("error response", { status: response.status, body: raw });
  return { raw, message };
}

export async function httpRequest(
  config: HttpClientConfig,
  request: HttpRequestConfig,
  errorBodyParser?: ErrorBodyParser,
): Promise<CarrierResult<HttpSuccess>> {
  const maxAttempts = config.maxAttempts ?? 4;
  const baseDelayMs = config.baseDelayMs ?? 200;
  const timeoutMs = config.timeoutMs ?? 3_000;
  const maxRetryAfterSeconds = config.maxRetryAfterSeconds ?? 5;
  const logger = config.logger;
  const carrier = request.carrier;

  let lastResult: CarrierResult<HttpSuccess> | null = null;
  let retryAfterMs = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const backoff = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, Math.max(backoff, retryAfterMs)));
      retryAfterMs = 0;
    }

    logger?.info("rating request", { url: request.url, attempt });
    logger?.debug("request payload", { body: request.body });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      const init: RequestInit = {
          method: request.method,
          headers: request.headers,
          signal: controller.signal,
        };
      if (request.body !== undefined) {
        init.body = request.body;
      }
      response = await Promise.race([
        config.fetch(request.url, init),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
      ]);
      clearTimeout(timeoutId);
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        lastResult = { ok: false, error: carrierError(carrier, "TIMEOUT", "Request timeout", true) };
        continue;
      }
      lastResult = { ok: false, error: carrierError(carrier, "NETWORK", `network error: ${error instanceof Error ? error.message : String(error)}`, true) };
      continue;
    }

    if (!response.ok) {
      const status = response.status;

      if (status === 401) {
        const { raw } = await parseErrorBody(response, logger);
        const err = mapStatusToError(carrier, status, null, errorBodyParser, raw);
        logger?.error("request failed", { code: err.code, message: err.message });
        return { ok: false, error: err };
      }

      if (status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!Number.isNaN(seconds)) {
            if (seconds > maxRetryAfterSeconds) {
              const { raw } = await parseErrorBody(response, logger);
              const err = mapStatusToError(carrier, status, null, errorBodyParser, raw);
              return { ok: false, error: err };
            }
            retryAfterMs = seconds * 1000;
          }
        }
        logger?.warn("retry", { attempt, status, retryAfterMs });
        const { raw } = await parseErrorBody(response, logger);
        lastResult = { ok: false, error: mapStatusToError(carrier, status, null, errorBodyParser, raw) };
        continue;
      }

      if (status >= 500) {
        logger?.warn("retry", { attempt, status, retryAfterMs: 0 });
        const { raw } = await parseErrorBody(response, logger);
        lastResult = { ok: false, error: mapStatusToError(carrier, status, null, errorBodyParser, raw) };
        continue;
      }

      const { raw } = await parseErrorBody(response, logger);
      const err = mapStatusToError(carrier, status, null, errorBodyParser, raw);
      logger?.error("request failed", { code: err.code, message: err.message });
      return { ok: false, error: err };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: carrierError(carrier, "PROVIDER", `Failed to parse ${carrier} response as JSON`) };
    }
    logger?.debug("response payload", { body: json });
    return { ok: true, data: { status: response.status, json } };
  }

  return lastResult ?? { ok: false, error: carrierError(carrier, "UNKNOWN", "Max retries exceeded", true) };
}
