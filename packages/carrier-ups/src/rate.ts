import type { RateRequest, RateQuote, Result } from "@pidgeon/core";

type UpsCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accountNumber: string;
};

type UpsRateProviderConfig = {
  readonly fetch: typeof globalThis.fetch;
  readonly credentials: UpsCredentials;
};

export class UpsRateProvider {
  private readonly config: UpsRateProviderConfig;

  constructor(config: UpsRateProviderConfig) {
    this.config = config;
  }

  async getRates(request: RateRequest): Promise<Result<RateQuote[]>> {
    const response = await this.config.fetch("https://onlinetools.ups.com/api/rating/v2409/Rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildRequestBody(request)),
    });

    const json = await response.json() as UpsRateResponseEnvelope;
    const ratedShipments = json.RateResponse.RatedShipment;

    const quotes: RateQuote[] = ratedShipments.map((shipment) => ({
      carrier: "UPS",
      serviceCode: shipment.Service.Code,
      serviceName: shipment.TimeInTransit.ServiceSummary.Service.Description,
      totalCharge: parseFloat(shipment.TotalCharges.MonetaryValue),
      currency: shipment.TotalCharges.CurrencyCode,
      transitDays: parseInt(shipment.TimeInTransit.ServiceSummary.EstimatedArrival.BusinessDaysInTransit, 10),
      billableWeight: {
        value: parseFloat(shipment.BillingWeight.Weight),
        unit: shipment.BillingWeight.UnitOfMeasurement.Code,
      },
      surcharges: shipment.RatedPackage.flatMap((pkg) =>
        (pkg.ItemizedCharges ?? []).map((charge) => ({
          type: charge.SubType,
          amount: parseFloat(charge.MonetaryValue),
        })),
      ),
      guaranteed: shipment.TimeInTransit.ServiceSummary.GuaranteedIndicator !== "",
    }));

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
