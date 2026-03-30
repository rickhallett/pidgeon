import { RateRequestSchema, httpRequest } from "@pidgeon/core";
import type { Address, CarrierError, CarrierProvider, CarrierResult, Logger, RateRequest, RateQuote, FetchFn, ErrorBodyParser } from "@pidgeon/core";

export type { FetchFn } from "@pidgeon/core";

type UpsCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accountNumber: string;
};

type RetryConfig = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly timeoutMs: number;
  readonly maxRetryAfterSeconds: number;
};

type UrlConfig = {
  readonly rating: string;
  readonly token: string;
};

type UpsRateProviderConfig = {
  readonly fetch: FetchFn;
  readonly credentials: UpsCredentials;
  readonly retry?: RetryConfig;
  readonly urls?: UrlConfig;
  readonly tokenExpiryBufferSeconds?: number;
  readonly logger?: Logger;
};

function upsError(code: CarrierError['code'], message: string, retriable = false): CarrierError {
  return { code, message, carrier: "UPS", retriable };
}

const upsErrorBodyParser: ErrorBodyParser = (_status: number, body: unknown): string | null => {
  const envelope = body as UpsErrorEnvelope | null;
  const errors = envelope?.response?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => `${e.code}: ${e.message}`).join("; ");
  }
  return null;
};

export class UpsRateProvider {
  private readonly fetchFn: FetchFn;
  private readonly credentials: UpsCredentials;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly ratingUrl: string;
  private readonly tokenUrl: string;
  private readonly tokenExpiryBufferSeconds: number;
  private readonly logger: Logger | undefined;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(config: UpsRateProviderConfig) {
    this.fetchFn = config.fetch;
    this.credentials = config.credentials;
    this.maxAttempts = config.retry?.maxAttempts ?? 4;
    this.baseDelayMs = config.retry?.baseDelayMs ?? 200;
    this.timeoutMs = config.retry?.timeoutMs ?? 3_000;
    this.maxRetryAfterSeconds = config.retry?.maxRetryAfterSeconds ?? 5;
    this.ratingUrl = config.urls?.rating ?? "https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit";
    this.tokenUrl = config.urls?.token ?? "https://onlinetools.ups.com/security/v1/oauth/token";
    this.tokenExpiryBufferSeconds = config.tokenExpiryBufferSeconds ?? 60;
    this.logger = config.logger;
  }

  async getRates(request: RateRequest): Promise<CarrierResult<RateQuote[]>> {
    const validation = RateRequestSchema.safeParse(request);
    if (!validation.success) {
      const messages = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return { ok: false, error: upsError("VALIDATION", `Validation failed: ${messages.join("; ")}`) };
    }

    return this.executeWithToken(request, false);
  }

  private async executeWithToken(request: RateRequest, isAuthRetry: boolean): Promise<CarrierResult<RateQuote[]>> {
    const tokenResult = await this.getToken();
    if (!tokenResult.ok) return tokenResult;

    const requestBody = this.buildRequestBody(request);

    const clientConfig: import("@pidgeon/core").HttpClientConfig = {
      fetch: this.fetchFn,
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      timeoutMs: this.timeoutMs,
      maxRetryAfterSeconds: this.maxRetryAfterSeconds,
      ...(this.logger !== undefined ? { logger: this.logger } : {}),
    };

    const result = await httpRequest(
      clientConfig,
      {
        url: this.ratingUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tokenResult.data}`,
        },
        body: JSON.stringify(requestBody),
        carrier: "UPS",
      },
      upsErrorBodyParser,
    );

    if (!result.ok) {
      if (result.error.code === "AUTH" && !isAuthRetry) {
        this.cachedToken = null;
        return this.executeWithToken(request, true);
      }
      return result;
    }

    const mapped = this.mapResponse(result.data.json);
    if (mapped.ok) {
      this.logger?.info("rating success", { quoteCount: mapped.data.length });
    }
    return mapped;
  }

  private mapResponse(json: unknown): CarrierResult<RateQuote[]> {
    const envelope = json as Record<string, unknown> | null;
    const rateResponse = envelope?.RateResponse as Record<string, unknown> | undefined;
    if (!rateResponse) {
      return { ok: false, error: upsError("PROVIDER", "Invalid response: missing RateResponse") };
    }

    const ratedShipments = rateResponse.RatedShipment;
    if (!Array.isArray(ratedShipments)) {
      return { ok: false, error: upsError("PROVIDER", "Invalid response: missing RatedShipment") };
    }

    const quotes: RateQuote[] = [];
    for (const shipment of ratedShipments as UpsRatedShipment[]) {
      try {
        const totalCharge = parseFloat(shipment.TotalCharges?.MonetaryValue);
        if (Number.isNaN(totalCharge)) {
          return { ok: false, error: upsError("PROVIDER", `Invalid response: unparseable monetary value "${shipment.TotalCharges?.MonetaryValue}"`) };
        }

        const weight = parseFloat(shipment.BillingWeight?.Weight);
        if (Number.isNaN(weight)) {
          return { ok: false, error: upsError("PROVIDER", `Invalid response: unparseable weight "${shipment.BillingWeight?.Weight}"`) };
        }

        const timeInTransit = shipment.TimeInTransit?.ServiceSummary;
        if (!timeInTransit) {
          return { ok: false, error: upsError("PROVIDER", "Invalid response: missing TimeInTransit data") };
        }

        const rawTransitDays = parseInt(timeInTransit.EstimatedArrival.BusinessDaysInTransit, 10);
        const transitDays = Number.isNaN(rawTransitDays) ? null : rawTransitDays;

        const arrival = timeInTransit.EstimatedArrival.Arrival;
        let estimatedDelivery: Date | null = null;
        if (arrival?.Date) {
          const y = arrival.Date.slice(0, 4);
          const m = arrival.Date.slice(4, 6);
          const d = arrival.Date.slice(6, 8);
          const parsed = new Date(`${y}-${m}-${d}`);
          if (!Number.isNaN(parsed.getTime())) {
            estimatedDelivery = parsed;
          }
        }

        const surcharges: Array<{ type: string; amount: number }> = [];
        for (const pkg of shipment.RatedPackage ?? []) {
          for (const charge of pkg.ItemizedCharges ?? []) {
            const amount = parseFloat(charge.MonetaryValue);
            if (Number.isNaN(amount)) {
              return { ok: false, error: upsError("PROVIDER", `Invalid response: unparseable surcharge amount "${charge.MonetaryValue}"`) };
            }
            surcharges.push({ type: charge.SubType, amount });
          }
        }

        quotes.push({
          carrier: "UPS",
          serviceCode: shipment.Service.Code,
          serviceName: timeInTransit.Service.Description,
          totalCharge,
          currency: shipment.TotalCharges.CurrencyCode,
          transitDays,
          estimatedDelivery,
          billableWeight: {
            value: weight,
            unit: shipment.BillingWeight.UnitOfMeasurement.Code,
          },
          surcharges,
          guaranteed: timeInTransit.GuaranteedIndicator != null && timeInTransit.GuaranteedIndicator !== "",
        });
      } catch (error: unknown) {
        return { ok: false, error: upsError("PROVIDER", `Invalid response: malformed shipment data (${error instanceof Error ? error.message : String(error)})`) };
      }
    }

    return { ok: true, data: quotes };
  }

  private async getToken(): Promise<CarrierResult<string>> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return { ok: true, data: this.cachedToken.accessToken };
    }
    return this.acquireToken();
  }

  private async acquireToken(): Promise<CarrierResult<string>> {
    const { clientId, clientSecret } = this.credentials;
    this.logger?.info("acquiring token");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, error: upsError("TIMEOUT", "token endpoint timeout", true) };
      }
      return { ok: false, error: upsError("AUTH", `token endpoint error: ${error instanceof Error ? error.message : String(error)}`) };
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { ok: false, error: upsError("AUTH", `UPS auth token error (${response.status})`) };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: upsError("AUTH", "Failed to parse token response as JSON") };
    }

    const body = json as Record<string, unknown>;
    const accessToken = body?.access_token;
    if (typeof accessToken !== "string") {
      return { ok: false, error: upsError("AUTH", "token response missing access_token") };
    }

    const rawExpiry = body.expires_in;
    const expiresIn = typeof rawExpiry === "number" ? rawExpiry : parseInt(String(rawExpiry), 10) || 0;
    this.cachedToken = {
      accessToken,
      expiresAt: Date.now() + Math.max(0, expiresIn - this.tokenExpiryBufferSeconds) * 1000,
    };
    this.logger?.info("token acquired", { expiresIn });

    return { ok: true, data: accessToken };
  }

  private buildRequestBody(request: RateRequest): unknown {
    return {
      RateRequest: {
        Request: {
          RequestOption: "Shop",
          SubVersion: "2108",
        },
        Shipment: {
          Shipper: {
            ShipperNumber: this.credentials.accountNumber,
            Address: this.mapAddress(request.origin),
          },
          ShipTo: {
            Address: this.mapAddress(request.destination),
          },
          ShipFrom: {
            Address: this.mapAddress(request.origin),
          },
          PaymentDetails: {
            ShipmentCharge: {
              Type: "01",
              BillShipper: {
                AccountNumber: this.credentials.accountNumber,
              },
            },
          },
          DeliveryTimeInformation: {
            PackageBillType: "03",
          },
          NumOfPieces: String(request.packages.length),
          Package: request.packages.map((pkg) => ({
            PackagingType: {
              Code: "02",
              Description: "Packaging",
            },
            Dimensions: {
              UnitOfMeasurement: {
                Code: this.mapDimensionUnit(pkg.dimensions.unit),
              },
              Length: String(pkg.dimensions.length),
              Width: String(pkg.dimensions.width),
              Height: String(pkg.dimensions.height),
            },
            PackageWeight: {
              UnitOfMeasurement: {
                Code: this.mapWeightUnit(pkg.weight.unit),
              },
              Weight: String(pkg.weight.value),
            },
          })),
        },
      },
    };
  }

  private mapAddress(address: Address): unknown {
    return {
      AddressLine: address.street,
      City: address.city,
      StateProvinceCode: address.state,
      PostalCode: address.postalCode,
      CountryCode: address.countryCode,
    };
  }

  private mapWeightUnit(unit: string): string {
    const map: Record<string, string> = { lb: "LBS", kg: "KGS", oz: "OZS" };
    return map[unit] ?? unit.toUpperCase();
  }

  private mapDimensionUnit(unit: string): string {
    const map: Record<string, string> = { in: "IN", cm: "CM" };
    return map[unit] ?? unit.toUpperCase();
  }
}

// Compile-time check: UpsRateProvider structurally satisfies CarrierProvider
null! as UpsRateProvider satisfies CarrierProvider;

// --- UPS response types (minimal, shaped by the test fixture) ---

type UpsRatedShipment = {
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

type UpsRatedPackage = {
  ItemizedCharges?: UpsItemizedCharge[];
};

type UpsItemizedCharge = {
  Code: string;
  CurrencyCode: string;
  MonetaryValue: string;
  SubType: string;
};

type UpsErrorEnvelope = {
  response?: {
    errors?: Array<{ code: string; message: string }>;
  };
};
