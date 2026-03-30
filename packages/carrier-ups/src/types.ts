import type { CarrierError } from "@pidgeon/core";

export type UpsCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accountNumber: string;
};

export type RetryConfig = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly timeoutMs: number;
  readonly maxRetryAfterSeconds: number;
};

export type UrlConfig = {
  readonly rating: string;
  readonly token: string;
};

export type UpsRateProviderConfig = {
  readonly fetch: import("@pidgeon/core").FetchFn;
  readonly credentials: UpsCredentials;
  readonly retry?: RetryConfig;
  readonly urls?: UrlConfig;
  readonly tokenExpiryBufferSeconds?: number;
  readonly logger?: import("@pidgeon/core").Logger;
};

export function upsError(code: CarrierError['code'], message: string, retriable = false): CarrierError {
  return { code, message, carrier: "UPS", retriable };
}

// --- UPS response types (minimal, shaped by the test fixture) ---

export type UpsRatedShipment = {
  Service: { Code: string };
  BillingWeight: {
    UnitOfMeasurement: { Code: string };
    Weight: string;
  };
  TotalCharges: {
    CurrencyCode: string;
    MonetaryValue: string;
  };
  RatedPackage: UpsRatedPackage[];
  TimeInTransit: {
    ServiceSummary: {
      Service: { Description: string };
      EstimatedArrival: {
        Arrival?: {
          Date?: string;
          Time?: string;
        };
        BusinessDaysInTransit: string;
      };
      GuaranteedIndicator?: string;
    };
  };
};

export type UpsRatedPackage = {
  ItemizedCharges?: UpsItemizedCharge[];
};

export type UpsItemizedCharge = {
  Code: string;
  CurrencyCode: string;
  MonetaryValue: string;
  SubType: string;
};

export type UpsErrorEnvelope = {
  response?: {
    errors?: Array<{ code: string; message: string }>;
  };
};
