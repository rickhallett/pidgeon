import type { CarrierResult, ErrorBodyParser, RateQuote, WeightUnit } from "@pidgeon/core";
import { upsError } from "./types.js";
import type { UpsRatedShipment, UpsErrorEnvelope } from "./types.js";

const UPS_WEIGHT_TO_CANONICAL: Record<string, WeightUnit> = {
  LBS: "lb",
  KGS: "kg",
  OZS: "oz",
};

function parseUpsWeightUnit(upsCode: string): WeightUnit {
  return UPS_WEIGHT_TO_CANONICAL[upsCode] ?? "lb";
}

export const upsErrorBodyParser: ErrorBodyParser = (_status: number, body: unknown): string | null => {
  const envelope = body as UpsErrorEnvelope | null;
  const errors = envelope?.response?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => `${e.code}: ${e.message}`).join("; ");
  }
  return null;
};

export function parseUpsRateResponse(json: unknown): CarrierResult<RateQuote[]> {
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
          unit: parseUpsWeightUnit(shipment.BillingWeight.UnitOfMeasurement.Code),
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
