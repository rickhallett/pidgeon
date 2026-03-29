import { z } from "zod";
import type { Result } from "@pidgeon/core";

const positiveFiniteInt = z.coerce.number().int().positive().finite();

const UpsConfigSchema = z.object({
  credentials: z.object({
    clientId: z.string().trim().min(1, "UPS_CLIENT_ID is required"),
    clientSecret: z.string().trim().min(1, "UPS_CLIENT_SECRET is required"),
    accountNumber: z.string().trim().min(1, "UPS_ACCOUNT_NUMBER is required"),
  }),
  retry: z.object({
    maxAttempts: positiveFiniteInt.max(10).default(4),
    baseDelayMs: positiveFiniteInt.max(30_000).default(200),
    timeoutMs: positiveFiniteInt.max(60_000).default(3_000),
    maxRetryAfterSeconds: positiveFiniteInt.max(300).default(5),
  }),
  urls: z.object({
    rating: z.string().url().default("https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit"),
    token: z.string().url().default("https://onlinetools.ups.com/security/v1/oauth/token"),
  }),
  tokenExpiryBufferSeconds: z.coerce.number().int().nonnegative().finite().default(60),
});

export type UpsConfig = z.infer<typeof UpsConfigSchema>;

export function loadUpsConfig(env: Record<string, string | undefined> = process.env): Result<UpsConfig> {
  const input = {
    credentials: {
      clientId: env.UPS_CLIENT_ID ?? "",
      clientSecret: env.UPS_CLIENT_SECRET ?? "",
      accountNumber: env.UPS_ACCOUNT_NUMBER ?? "",
    },
    retry: {
      ...(env.UPS_MAX_ATTEMPTS != null ? { maxAttempts: env.UPS_MAX_ATTEMPTS } : {}),
      ...(env.UPS_BASE_DELAY_MS != null ? { baseDelayMs: env.UPS_BASE_DELAY_MS } : {}),
      ...(env.UPS_TIMEOUT_MS != null ? { timeoutMs: env.UPS_TIMEOUT_MS } : {}),
      ...(env.UPS_MAX_RETRY_AFTER_SECONDS != null ? { maxRetryAfterSeconds: env.UPS_MAX_RETRY_AFTER_SECONDS } : {}),
    },
    urls: {
      ...(env.UPS_RATING_URL != null ? { rating: env.UPS_RATING_URL } : {}),
      ...(env.UPS_TOKEN_URL != null ? { token: env.UPS_TOKEN_URL } : {}),
    },
    ...(env.UPS_TOKEN_EXPIRY_BUFFER_SECONDS != null ? { tokenExpiryBufferSeconds: env.UPS_TOKEN_EXPIRY_BUFFER_SECONDS } : {}),
  };

  const result = UpsConfigSchema.safeParse(input);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      const envKey = pathToEnvKey(path);
      return envKey ? `${envKey}: ${issue.message}` : `${path}: ${issue.message}`;
    });
    return { ok: false, error: messages.join("; ") };
  }
  return { ok: true, data: result.data };
}

function pathToEnvKey(path: string): string | null {
  const map: Record<string, string> = {
    "credentials.clientId": "UPS_CLIENT_ID",
    "credentials.clientSecret": "UPS_CLIENT_SECRET",
    "credentials.accountNumber": "UPS_ACCOUNT_NUMBER",
    "retry.maxAttempts": "UPS_MAX_ATTEMPTS",
    "retry.baseDelayMs": "UPS_BASE_DELAY_MS",
    "retry.timeoutMs": "UPS_TIMEOUT_MS",
    "retry.maxRetryAfterSeconds": "UPS_MAX_RETRY_AFTER_SECONDS",
    "urls.rating": "UPS_RATING_URL",
    "urls.token": "UPS_TOKEN_URL",
    "tokenExpiryBufferSeconds": "UPS_TOKEN_EXPIRY_BUFFER_SECONDS",
  };
  return map[path] ?? null;
}
