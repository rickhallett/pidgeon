// @pidgeon/core — entry point

// --- Result type ---

export type Result<T, E = string> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

// --- Carrier error ---

export type CarrierErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'VALIDATION' | 'TIMEOUT' | 'PROVIDER' | 'UNKNOWN';

export type CarrierError = {
  readonly code: CarrierErrorCode;
  readonly message: string;
  readonly carrier: string;
  readonly retriable: boolean;
};

// --- Domain types (inferred from Zod schemas) ---

export type { Address, Weight, Dimensions, Package, RateRequest } from "./schemas.js";

// --- Rate Quote ---

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

// --- Logger ---

export type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

// --- Carrier abstraction ---

export type CarrierResult<T> = Result<T, CarrierError>;

export type CarrierProvider = {
  getRates(request: RateRequest): Promise<CarrierResult<RateQuote[]>>;
};

// --- Aggregated result ---

export type AggregatedRateResult =
  | { readonly ok: true; readonly data: RateQuote[]; readonly failures: readonly CarrierError[] }
  | { readonly ok: false; readonly error: string; readonly failures: readonly CarrierError[] };

// --- Zod schemas ---

export {
  AddressSchema,
  WeightSchema,
  DimensionsSchema,
  PackageSchema,
  RateRequestSchema,
} from "./schemas.js";

// --- Registry ---

export { CarrierRegistry } from "./registry.js";
