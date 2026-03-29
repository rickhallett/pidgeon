import type { RateRequest, RateQuote, Result } from "@pidgeon/core";

type UpsCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accountNumber: string;
};

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type UpsRateProviderConfig = {
  readonly fetch: FetchFn;
  readonly credentials: UpsCredentials;
};

export class UpsRateProvider {
  private readonly config: UpsRateProviderConfig;

  constructor(config: UpsRateProviderConfig) {
    this.config = config;
  }

  async getRates(request: RateRequest): Promise<Result<RateQuote[]>> {
    let response: Response;
    try {
      response = await this.config.fetch("https://onlinetools.ups.com/api/rating/v2409/Rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.buildRequestBody(request)),
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, error: "Request timeout" };
      }
      return { ok: false, error: `network error: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (!response.ok) {
      return this.handleHttpError(response);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: "Failed to parse UPS response as JSON" };
    }

    return this.mapResponse(json);
  }

  private async handleHttpError(response: Response): Promise<Result<RateQuote[]>> {
    const status = response.status;

    let upsMessage = "";
    try {
      const body = await response.json() as UpsErrorEnvelope;
      const errors = body?.response?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        upsMessage = errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      }
    } catch {
      // Body isn't parseable JSON (e.g., 500 with plain text)
    }

    if (status === 401) {
      return { ok: false, error: `UPS auth error (${status}): ${upsMessage || "Unauthorized"}` };
    }
    if (status === 429) {
      return { ok: false, error: `UPS rate limit exceeded (${status}): ${upsMessage || "Too many requests"}` };
    }
    if (upsMessage) {
      return { ok: false, error: `UPS error (${status}): ${upsMessage}` };
    }
    return { ok: false, error: `UPS HTTP error (${status})` };
  }

  private mapResponse(json: unknown): Result<RateQuote[]> {
    const envelope = json as Record<string, unknown> | null;
    const rateResponse = envelope?.RateResponse as Record<string, unknown> | undefined;
    if (!rateResponse) {
      return { ok: false, error: "Invalid response: missing RateResponse" };
    }

    const ratedShipments = rateResponse.RatedShipment;
    if (!Array.isArray(ratedShipments)) {
      return { ok: false, error: "Invalid response: missing RatedShipment" };
    }

    const quotes: RateQuote[] = [];
    for (const shipment of ratedShipments as UpsRatedShipment[]) {
      const totalCharge = parseFloat(shipment.TotalCharges?.MonetaryValue);
      if (Number.isNaN(totalCharge)) {
        return { ok: false, error: `Invalid response: unparseable monetary value "${shipment.TotalCharges?.MonetaryValue}"` };
      }

      const weight = parseFloat(shipment.BillingWeight?.Weight);
      if (Number.isNaN(weight)) {
        return { ok: false, error: `Invalid response: unparseable weight "${shipment.BillingWeight?.Weight}"` };
      }

      const timeInTransit = shipment.TimeInTransit?.ServiceSummary;
      if (!timeInTransit) {
        return { ok: false, error: "Invalid response: missing TimeInTransit data" };
      }

      const transitDays = parseInt(timeInTransit.EstimatedArrival.BusinessDaysInTransit, 10);
      if (Number.isNaN(transitDays)) {
        return { ok: false, error: "Invalid response: unparseable transit days" };
      }

      const surcharges: Array<{ type: string; amount: number }> = [];
      for (const pkg of shipment.RatedPackage ?? []) {
        for (const charge of pkg.ItemizedCharges ?? []) {
          const amount = parseFloat(charge.MonetaryValue);
          if (Number.isNaN(amount)) {
            return { ok: false, error: `Invalid response: unparseable surcharge amount "${charge.MonetaryValue}"` };
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
        billableWeight: {
          value: weight,
          unit: shipment.BillingWeight.UnitOfMeasurement.Code,
        },
        surcharges,
        guaranteed: timeInTransit.GuaranteedIndicator !== "",
      });
    }

    return { ok: true, data: quotes };
  }

  private buildRequestBody(_request: RateRequest): unknown {
    // Minimal stub — request building is Step 4 in BUILD_ORDER
    return {};
  }
}

// --- UPS response types (minimal, shaped by the test fixture) ---

type UpsRateResponseEnvelope = {
  RateResponse: {
    RatedShipment: UpsRatedShipment[];
  };
};

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
        BusinessDaysInTransit: string;
      };
      GuaranteedIndicator: string;
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
