// @pidgeon/core — entry point

// --- Result type ---

export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

// --- Address ---

export type Address = {
  readonly street: string;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly city: string;
  readonly state: string;
};

// --- Package ---

export type Weight = {
  readonly value: number;
  readonly unit: string;
};

export type Dimensions = {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly unit: string;
};

export type Package = {
  readonly weight: Weight;
  readonly dimensions: Dimensions;
};

// --- Rate Request / Quote ---

export type RateRequest = {
  readonly origin: Address;
  readonly destination: Address;
  readonly packages: readonly Package[];
  readonly serviceCode?: string;
};

export type Surcharge = {
  readonly type: string;
  readonly amount: number;
};

export type RateQuote = {
  readonly carrier: string;
  readonly serviceCode: string;
  readonly serviceName: string;
  readonly totalCharge: number;
  readonly currency: string;
  readonly transitDays: number | null;
  readonly estimatedDelivery: Date | null;
  readonly billableWeight: Weight;
  readonly surcharges: readonly Surcharge[];
  readonly guaranteed: boolean;
};

// --- Carrier abstraction ---

export type CarrierProvider = {
  getRates(request: RateRequest): Promise<Result<RateQuote[]>>;
};

// --- Registry ---

export { CarrierRegistry } from "./registry.js";
