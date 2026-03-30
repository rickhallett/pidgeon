import type { AggregatedRateResult, CarrierCapability, CarrierDescriptor, CarrierError, CarrierProvider, CarrierResult, RateRequest, Result } from "./index.js";

type RegistryEntry = {
  readonly provider: CarrierProvider;
  readonly descriptor: CarrierDescriptor;
};

export class CarrierRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(
    name: string,
    provider: CarrierProvider,
    options?: { capabilities?: CarrierCapability[] },
  ): void {
    const key = name.toLowerCase();
    if (this.entries.has(key)) {
      throw new Error(`Carrier "${name}" is already registered`);
    }
    const descriptor: CarrierDescriptor = {
      name: key,
      capabilities: options?.capabilities ?? ["rate"],
    };
    this.entries.set(key, { provider, descriptor });
  }

  resolve(name: string): Result<CarrierProvider> {
    const entry = this.entries.get(name.toLowerCase());
    if (!entry) {
      return { ok: false, error: `Unknown carrier: ${name}` };
    }
    return { ok: true, data: entry.provider };
  }

  carriers(): string[] {
    return [...this.entries.keys()];
  }

  describe(name: string): CarrierDescriptor | null {
    const entry = this.entries.get(name.toLowerCase());
    return entry?.descriptor ?? null;
  }

  descriptions(): CarrierDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  async getRatesFromAll(request: RateRequest): Promise<AggregatedRateResult> {
    if (this.entries.size === 0) {
      return { ok: false, error: "No carriers registered", failures: [] };
    }

    const results = await Promise.all(
      [...this.entries.entries()].map(([name, entry]) =>
        entry.provider.getRates(request).catch((err: unknown): CarrierResult<never> => ({
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
