import { describe, it, expect } from "bun:test";
import type { RateRequest, RateQuote, Result } from "./index.js";

/**
 * BUILD_ORDER Step 10 — CLI.
 *
 * Commander-based CLI with a `rate` subcommand that wires the working service
 * into a command-line interface. Tests verify the wiring layer: arg parsing
 * to domain call, output formatting, and error reporting.
 *
 * The CLI is tested via a createProgram() factory that accepts dependencies
 * (provider, output writer) so tests run in-process without subprocesses.
 *
 * Dependencies that must exist for this file to compile:
 *   - createProgram(deps) from "./cli.js"
 *   - CarrierProvider interface from "./index.js"
 */

// --- Fake provider ---

type GetRatesFn = (request: RateRequest) => Promise<Result<RateQuote[]>>;

function fakeProvider(getRates: GetRatesFn) {
  return { getRates };
}

const SAMPLE_QUOTES: RateQuote[] = [
  {
    carrier: "UPS",
    serviceCode: "03",
    serviceName: "UPS Ground",
    totalCharge: 12.5,
    currency: "USD",
    transitDays: 3,
    estimatedDelivery: null,
    billableWeight: { value: 2, unit: "LBS" },
    surcharges: [{ type: "FUEL", amount: 1.25 }],
    guaranteed: false,
  },
  {
    carrier: "UPS",
    serviceCode: "02",
    serviceName: "UPS 2nd Day Air",
    totalCharge: 28.75,
    currency: "USD",
    transitDays: 2,
    estimatedDelivery: null,
    billableWeight: { value: 2, unit: "LBS" },
    surcharges: [],
    guaranteed: true,
  },
];

// --- Output capture helper ---

function captureOutput(): { lines: string[]; write: (text: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write: (text: string) => lines.push(text),
  };
}

// Standard args for a valid rate command
const VALID_RATE_ARGS = [
  "node", "pidgeon", "rate",
  "--origin-street", "123 Main St",
  "--origin-postal", "21093",
  "--origin-country", "US",
  "--origin-city", "Timonium",
  "--origin-state", "MD",
  "--dest-street", "456 Oak Ave",
  "--dest-postal", "30005",
  "--dest-country", "US",
  "--dest-city", "Alpharetta",
  "--dest-state", "GA",
  "--weight", "2",
  "--weight-unit", "lb",
  "--length", "10",
  "--width", "8",
  "--height", "6",
  "--dim-unit", "in",
];

// --- Subcommand existence ---

describe("cli: rate subcommand", () => {
  it("calls the provider with parsed arguments and writes output", async () => {
    let capturedRequest: RateRequest | null = null;
    const provider = fakeProvider(async (req) => {
      capturedRequest = req;
      return { ok: true, data: SAMPLE_QUOTES };
    });
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    // Provider was called
    expect(capturedRequest).not.toBeNull();

    // Origin mapped correctly
    expect(capturedRequest!.origin.postalCode).toBe("21093");
    expect(capturedRequest!.origin.countryCode).toBe("US");
    expect(capturedRequest!.origin.city).toBe("Timonium");
    expect(capturedRequest!.origin.state).toBe("MD");

    // Destination mapped correctly
    expect(capturedRequest!.destination.postalCode).toBe("30005");
    expect(capturedRequest!.destination.countryCode).toBe("US");

    // Package mapped correctly
    expect(capturedRequest!.packages).toHaveLength(1);
    expect(capturedRequest!.packages[0]!.weight.value).toBe(2);
    expect(capturedRequest!.packages[0]!.weight.unit).toBe("lb");
    expect(capturedRequest!.packages[0]!.dimensions.length).toBe(10);
    expect(capturedRequest!.packages[0]!.dimensions.unit).toBe("in");
  });
});

// --- Output formatting ---

describe("cli: output formatting", () => {
  it("displays service name and total charge for each quote", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: SAMPLE_QUOTES }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    const text = output.lines.join("\n");

    // Both services appear
    expect(text).toContain("UPS Ground");
    expect(text).toContain("UPS 2nd Day Air");

    // Prices appear
    expect(text).toContain("12.50");
    expect(text).toContain("28.75");
  });

  it("displays transit days for each quote", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: SAMPLE_QUOTES }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    const text = output.lines.join("\n");

    // Transit days appear with "day" context to avoid matching other numbers
    expect(text).toMatch(/3\s*day/);
    expect(text).toMatch(/2\s*day/);
  });

  it("displays currency", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: SAMPLE_QUOTES }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    const text = output.lines.join("\n");
    expect(text).toContain("USD");
  });

  it("indicates guaranteed delivery when applicable", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: SAMPLE_QUOTES }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    const text = output.lines.join("\n");
    // UPS 2nd Day Air is guaranteed — output should indicate this somehow
    expect(text.toLowerCase()).toContain("guaranteed");
  });

  it("handles empty quotes array gracefully", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: [] }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    const text = output.lines.join("\n");
    // Should indicate no quotes found, not crash or print nothing
    expect(text.toLowerCase()).toMatch(/no\s+(rate\s+)?quotes/);
  });
});

// --- Error handling ---

describe("cli: error handling", () => {
  it("displays provider error message on failure", async () => {
    const provider = fakeProvider(async () => ({ ok: false, error: "UPS auth error (401): Invalid Access Token" }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync(VALID_RATE_ARGS);

    const text = output.lines.join("\n");
    expect(text).toContain("UPS auth error (401)");
  });

  it("sets non-zero exit code on provider failure", async () => {
    const provider = fakeProvider(async () => ({ ok: false, error: "Network timeout" }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });

    let exitCode: number | undefined;
    program.exitOverride((err) => {
      exitCode = err.exitCode;
      throw err;
    });

    try {
      await program.parseAsync(VALID_RATE_ARGS);
    } catch {
      // Commander's exitOverride throws — expected
    }

    // Must actually exit non-zero, not just print the error
    expect(exitCode).toBeDefined();
    expect(exitCode).not.toBe(0);
  });

  it("rejects non-numeric weight with a clear error", async () => {
    let providerCalled = false;
    const provider = fakeProvider(async () => {
      providerCalled = true;
      return { ok: true, data: [] };
    });
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    program.exitOverride();

    const argsWithBadWeight = VALID_RATE_ARGS.map((a, i) =>
      VALID_RATE_ARGS[i - 1] === "--weight" ? "abc" : a,
    );

    let threw = false;
    try {
      await program.parseAsync(argsWithBadWeight);
    } catch {
      threw = true;
    }

    // Provider should NOT be called with NaN — validation must catch this
    expect(providerCalled).toBe(false);

    // Output or throw should mention the invalid value
    const text = output.lines.join("\n").toLowerCase();
    expect(threw || text.includes("weight") || text.includes("invalid") || text.includes("numeric")).toBe(true);
  });

  it("rejects non-numeric dimensions with a clear error", async () => {
    let providerCalled = false;
    const provider = fakeProvider(async () => {
      providerCalled = true;
      return { ok: true, data: [] };
    });
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    program.exitOverride();

    const argsWithBadLength = VALID_RATE_ARGS.map((a, i) =>
      VALID_RATE_ARGS[i - 1] === "--length" ? "wide" : a,
    );

    let threw = false;
    try {
      await program.parseAsync(argsWithBadLength);
    } catch {
      threw = true;
    }

    // Provider should NOT be called with NaN
    expect(providerCalled).toBe(false);
  });

  it("surfaces Commander validation errors through deps.write", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: [] }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    program.exitOverride();

    // Missing multiple required options
    let threw = false;
    try {
      await program.parseAsync(["node", "pidgeon", "rate", "--weight", "2", "--weight-unit", "lb"]);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    // Commander's missing-option error should reach deps.write, not be swallowed
    const text = output.lines.join("\n");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/required|missing/i);
  });

  it("displays validation error for missing required origin postal code", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: [] }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    program.exitOverride();

    // Remove --origin-postal from args
    const argsWithoutOrigin = [
      "node", "pidgeon", "rate",
      "--origin-street", "123 Main St",
      "--origin-country", "US",
      "--origin-city", "Timonium",
      "--origin-state", "MD",
      "--dest-street", "456 Oak Ave",
      "--dest-postal", "30005",
      "--dest-country", "US",
      "--dest-city", "Alpharetta",
      "--dest-state", "GA",
      "--weight", "2",
      "--weight-unit", "lb",
      "--length", "10",
      "--width", "8",
      "--height", "6",
      "--dim-unit", "in",
    ];

    let threw = false;
    try {
      await program.parseAsync(argsWithoutOrigin);
    } catch {
      threw = true;
    }

    // Commander should throw/exit for missing required option,
    // or our validation layer should catch it
    expect(threw).toBe(true);
  });
});

// --- JSON output mode ---

describe("cli: json output", () => {
  it("outputs valid JSON when --json flag is passed", async () => {
    const provider = fakeProvider(async () => ({ ok: true, data: SAMPLE_QUOTES }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync([...VALID_RATE_ARGS, "--json"]);

    const text = output.lines.join("\n");
    const parsed = JSON.parse(text);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].serviceName).toBe("UPS Ground");
    expect(parsed[0].totalCharge).toBe(12.5);
  });

  it("outputs JSON error object on provider failure with --json", async () => {
    const provider = fakeProvider(async () => ({ ok: false, error: "UPS HTTP error (500)" }));
    const output = captureOutput();

    const { createProgram } = await import("./cli.js");
    const program = createProgram({ provider, write: output.write });
    await program.parseAsync([...VALID_RATE_ARGS, "--json"]);

    const text = output.lines.join("\n");
    const parsed = JSON.parse(text);

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("500");
  });
});
