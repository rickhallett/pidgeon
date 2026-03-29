import { describe, it, expect } from "bun:test";
import { loadUpsConfig } from "./config.js";

/**
 * BUILD_ORDER Step 9 — Config extraction.
 *
 * Tests that UPS provider configuration is loaded from environment variables,
 * validated with Zod, and provides sensible defaults for optional values.
 * Invalid or missing config fails fast with clear error messages.
 *
 * All tests pass an explicit env record to loadUpsConfig() instead of
 * mutating process.env — no global state, no save/restore boilerplate.
 */

const VALID_ENV: Record<string, string> = {
  UPS_CLIENT_ID: "test-client-id",
  UPS_CLIENT_SECRET: "test-client-secret",
  UPS_ACCOUNT_NUMBER: "test-account",
};

// --- Required fields ---

describe("config: required credentials", () => {
  it("loads valid credentials from environment variables", () => {
    const result = loadUpsConfig(VALID_ENV);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.credentials.clientId).toBe("test-client-id");
    expect(result.data.credentials.clientSecret).toBe("test-client-secret");
    expect(result.data.credentials.accountNumber).toBe("test-account");
  });

  it("fails when UPS_CLIENT_ID is missing", () => {
    const result = loadUpsConfig({ UPS_CLIENT_SECRET: "secret", UPS_ACCOUNT_NUMBER: "acct" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_CLIENT_ID");
  });

  it("fails when UPS_CLIENT_SECRET is missing", () => {
    const result = loadUpsConfig({ UPS_CLIENT_ID: "id", UPS_ACCOUNT_NUMBER: "acct" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_CLIENT_SECRET");
  });

  it("fails when UPS_ACCOUNT_NUMBER is missing", () => {
    const result = loadUpsConfig({ UPS_CLIENT_ID: "id", UPS_CLIENT_SECRET: "secret" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_ACCOUNT_NUMBER");
  });

  it("fails when all credentials are missing", () => {
    const result = loadUpsConfig({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects whitespace-only credentials", () => {
    const result = loadUpsConfig({ ...VALID_ENV, UPS_CLIENT_ID: "  " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_CLIENT_ID");
  });
});

// --- Optional retry policy ---

describe("config: retry policy defaults", () => {
  it("provides default retry policy when not specified", () => {
    const result = loadUpsConfig(VALID_ENV);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.retry.maxAttempts).toBe(4);
    expect(result.data.retry.baseDelayMs).toBe(200);
    expect(result.data.retry.timeoutMs).toBe(3_000);
    expect(result.data.retry.maxRetryAfterSeconds).toBe(5);
  });

  it("accepts custom retry policy from environment", () => {
    const result = loadUpsConfig({
      ...VALID_ENV,
      UPS_MAX_ATTEMPTS: "6",
      UPS_BASE_DELAY_MS: "500",
      UPS_TIMEOUT_MS: "10000",
      UPS_MAX_RETRY_AFTER_SECONDS: "10",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.retry.maxAttempts).toBe(6);
    expect(result.data.retry.baseDelayMs).toBe(500);
    expect(result.data.retry.timeoutMs).toBe(10_000);
    expect(result.data.retry.maxRetryAfterSeconds).toBe(10);
  });

  it("rejects non-numeric retry values", () => {
    const result = loadUpsConfig({ ...VALID_ENV, UPS_MAX_ATTEMPTS: "abc" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_MAX_ATTEMPTS");
  });

  it("rejects zero or negative max attempts", () => {
    const result = loadUpsConfig({ ...VALID_ENV, UPS_MAX_ATTEMPTS: "0" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_MAX_ATTEMPTS");
  });

  it("rejects Infinity", () => {
    const result = loadUpsConfig({ ...VALID_ENV, UPS_TIMEOUT_MS: "Infinity" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_TIMEOUT_MS");
  });

  it("rejects values exceeding upper bounds", () => {
    const result = loadUpsConfig({ ...VALID_ENV, UPS_MAX_ATTEMPTS: "99" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS_MAX_ATTEMPTS");
  });
});

// --- Optional URLs ---

describe("config: endpoint URLs", () => {
  it("provides default UPS production URLs", () => {
    const result = loadUpsConfig(VALID_ENV);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.urls.rating).toContain("onlinetools.ups.com");
    expect(result.data.urls.token).toContain("onlinetools.ups.com");
  });

  it("accepts custom URLs for sandbox/CIE environments", () => {
    const result = loadUpsConfig({
      ...VALID_ENV,
      UPS_RATING_URL: "https://wwwcie.ups.com/api/rating/v2409/Shoptimeintransit",
      UPS_TOKEN_URL: "https://wwwcie.ups.com/security/v1/oauth/token",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.urls.rating).toContain("wwwcie.ups.com");
    expect(result.data.urls.token).toContain("wwwcie.ups.com");
  });
});

// --- Token expiry buffer ---

describe("config: token expiry buffer", () => {
  it("defaults token expiry buffer to 60 seconds", () => {
    const result = loadUpsConfig(VALID_ENV);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tokenExpiryBufferSeconds).toBe(60);
  });

  it("accepts custom token expiry buffer", () => {
    const result = loadUpsConfig({ ...VALID_ENV, UPS_TOKEN_EXPIRY_BUFFER_SECONDS: "120" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tokenExpiryBufferSeconds).toBe(120);
  });
});
