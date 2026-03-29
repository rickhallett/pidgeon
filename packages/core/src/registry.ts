import type { AggregatedRateResult, CarrierError, CarrierProvider, CarrierResult, RateRequest, Result } from "./index.js";

export class CarrierRegistry {
  private readonly providers = new Map<string, CarrierProvider>();

  register(name: string, provider: CarrierProvider): void {
    const key = name.toLowerCase();
    if (this.providers.has(key)) {
      throw new Error(`Carrier "${name}" is already registered`);
    }
    this.providers.set(key, provider);
  }

  resolve(name: string): Result<CarrierProvider> {
    const provider = this.providers.get(name.toLowerCase());
    if (!provider) {
      return { ok: false, error: `Unknown carrier: ${name}` };
    }
    return { ok: true, data: provider };
  }

  carriers(): string[] {
    return [...this.providers.keys()];
  }

  async getRatesFromAll(request: RateRequest): Promise<AggregatedRateResult> {
    if (this.providers.size === 0) {
      return { ok: false, error: "No carriers registered", failures: [] };
    }

    const results = await Promise.all(
      [...this.providers.entries()].map(([name, p]) =>
        p.getRates(request).catch((err: unknown): CarrierResult<never> => ({
          ok: false,
          error: { code: "UNKNOWN", message: String(err), carrier: name, retriable: false },
        })),
      ),
    );

    const quotes: import("./index.js").RateQuote[] = [];
    const failures: CarrierError[] = [];

    for (const result of results) {
      if (result.ok) {
        quotes.push(...result.data);
      } else {
        failures.push(result.error);
      }
    }

    if (quotes.length === 0) {
      return { ok: false, error: failures.map((e) => e.message).join("; "), failures };
    }

    return { ok: true, data: quotes, failures };
  }
}
