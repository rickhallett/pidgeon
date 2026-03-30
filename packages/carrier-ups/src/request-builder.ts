import type { Address, RateRequest } from "@pidgeon/core";

export function buildUpsRateRequest(request: RateRequest, accountNumber: string): unknown {
  return {
    RateRequest: {
      Request: {
        RequestOption: "Shop",
        SubVersion: "2108",
      },
      Shipment: {
        Shipper: {
          ShipperNumber: accountNumber,
          Address: mapAddress(request.origin),
        },
        ShipTo: {
          Address: mapAddress(request.destination),
        },
        ShipFrom: {
          Address: mapAddress(request.origin),
        },
        PaymentDetails: {
          ShipmentCharge: {
            Type: "01",
            BillShipper: {
              AccountNumber: accountNumber,
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
              Code: mapDimensionUnit(pkg.dimensions.unit),
            },
            Length: String(pkg.dimensions.length),
            Width: String(pkg.dimensions.width),
            Height: String(pkg.dimensions.height),
          },
          PackageWeight: {
            UnitOfMeasurement: {
              Code: mapWeightUnit(pkg.weight.unit),
            },
            Weight: String(pkg.weight.value),
          },
        })),
      },
    },
  };
}

function mapAddress(address: Address): unknown {
  return {
    AddressLine: address.street,
    City: address.city,
    StateProvinceCode: address.state,
    PostalCode: address.postalCode,
    CountryCode: address.countryCode,
  };
}

export function mapWeightUnit(unit: string): string {
  const map: Record<string, string> = { lb: "LBS", kg: "KGS", oz: "OZS" };
  return map[unit] ?? unit.toUpperCase();
}

export function mapDimensionUnit(unit: string): string {
  const map: Record<string, string> = { in: "IN", cm: "CM" };
  return map[unit] ?? unit.toUpperCase();
}
