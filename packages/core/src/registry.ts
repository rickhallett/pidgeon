import type { CarrierProvider, RateRequest, RateQuote, Result } from "./index.js";

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

  async getRatesFromAll(request: RateRequest): Promise<Result<RateQuote[]>> {
    if (this.providers.size === 0) {
      return { ok: false, error: "No carriers registered" };
    }

    const results = await Promise.all(
      [...this.providers.values()].map((p) =>
        p.getRates(request).catch((err: unknown): Result<RateQuote[]> => ({ ok: false, error: String(err) })),
      ),
    );

    const quotes: RateQuote[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.ok) {
        quotes.push(...result.data);
      } else {
        errors.push(result.error);
      }
    }

    if (quotes.length === 0) {
      return { ok: false, error: errors.join("; ") };
    }

    return { ok: true, data: quotes };
  }
}
