# UPS Rating API Reference

Source: https://github.com/UPS-API/api-documentation/blob/main/Rating.yaml

## Endpoints

### Current: POST /rating/{version}/{requestoption}
- version: v2409
- requestoption: Rate | Shop | Ratetimeintransit | Shoptimeintransit

### Servers
- CIE (testing): https://wwwcie.ups.com/api
- Production: https://onlinetools.ups.com/api

## Authentication

OAuth 2.0 Client Credentials
- Token URL: https://wwwcie.ups.com/security/v1/oauth/token
- Method: client_secret_basic (Base64 of clientId:clientSecret in Authorization header)

## Service Codes

### Domestic (US)
- 01: Next Day Air
- 02: 2nd Day Air
- 03: Ground
- 12: 3 Day Select
- 13: Next Day Air Saver
- 14: Next Day Air Early
- 59: 2nd Day Air A.M.
- 75: UPS Heavy Goods

### International
- 07: Worldwide Express
- 08: Worldwide Expedited
- 11: Standard
- 54: Worldwide Express Plus
- 65: Saver
- 96: Worldwide Express Freight

## Packaging Type Codes
- 01: UPS Letter
- 02: Package (Customer Supplied)
- 03: Tube
- 04: Pak
- 21: Express Box

## Request Structure

```json
{
  "RateRequest": {
    "Request": {
      "RequestOption": "Shop",
      "SubVersion": "2108",
      "TransactionReference": {
        "CustomerContext": "CustomerContext"
      }
    },
    "Shipment": {
      "Shipper": {
        "Name": "ShipperName",
        "ShipperNumber": "<shipper_number>",
        "Address": {
          "AddressLine": "123 main street",
          "City": "TIMONIUM",
          "StateProvinceCode": "MD",
          "PostalCode": "21093",
          "CountryCode": "US"
        }
      },
      "ShipTo": {
        "Name": "ShipToName",
        "Address": {
          "AddressLine": "ShipToAddressLine",
          "City": "Alpharetta",
          "StateProvinceCode": "GA",
          "PostalCode": "30005",
          "CountryCode": "US"
        }
      },
      "ShipFrom": {
        "Name": "ShipFromName",
        "Address": {
          "AddressLine": "ShipFromAddressLine",
          "City": "TIMONIUM",
          "StateProvinceCode": "MD",
          "PostalCode": "21093",
          "CountryCode": "US"
        }
      },
      "PaymentDetails": {
        "ShipmentCharge": {
          "Type": "01",
          "BillShipper": {
            "AccountNumber": "<account_number>"
          }
        }
      },
      "Service": {
        "Code": "03",
        "Description": "Ground"
      },
      "NumOfPieces": "1",
      "Package": {
        "PackagingType": {
          "Code": "02",
          "Description": "Packaging"
        },
        "Dimensions": {
          "UnitOfMeasurement": {
            "Code": "IN",
            "Description": "Inches"
          },
          "Length": "5",
          "Width": "5",
          "Height": "5"
        },
        "PackageWeight": {
          "UnitOfMeasurement": {
            "Code": "LBS",
            "Description": "Pounds"
          },
          "Weight": "1"
        }
      }
    }
  }
}
```

## Response Structure (from OpenAPI schema)

```json
{
  "RateResponse": {
    "Response": {
      "ResponseStatus": {
        "Code": "1",
        "Description": "Success"
      },
      "Alert": [
        {
          "Code": "110971",
          "Description": "Your invoice may vary from the displayed reference rates"
        }
      ],
      "TransactionReference": {
        "CustomerContext": "CustomerContext"
      }
    },
    "RatedShipment": [
      {
        "Service": {
          "Code": "03",
          "Description": ""
        },
        "RatedShipmentAlert": [
          {
            "Code": "110971",
            "Description": "Your invoice may vary from the displayed reference rates"
          }
        ],
        "BillingWeight": {
          "UnitOfMeasurement": {
            "Code": "LBS",
            "Description": "Pounds"
          },
          "Weight": "1.0"
        },
        "TransportationCharges": {
          "CurrencyCode": "USD",
          "MonetaryValue": "12.36"
        },
        "BaseServiceCharge": {
          "CurrencyCode": "USD",
          "MonetaryValue": "12.36"
        },
        "ServiceOptionsCharges": {
          "CurrencyCode": "USD",
          "MonetaryValue": "0.00"
        },
        "TotalCharges": {
          "CurrencyCode": "USD",
          "MonetaryValue": "12.36"
        },
        "GuaranteedDelivery": {
          "BusinessDaysInTransit": "2",
          "DeliveryByTime": ""
        },
        "RatedPackage": [
          {
            "TransportationCharges": {
              "CurrencyCode": "USD",
              "MonetaryValue": "12.36"
            },
            "BaseServiceCharge": {
              "CurrencyCode": "USD",
              "MonetaryValue": "12.36"
            },
            "ServiceOptionsCharges": {
              "CurrencyCode": "USD",
              "MonetaryValue": "0.00"
            },
            "TotalCharges": {
              "CurrencyCode": "USD",
              "MonetaryValue": "12.36"
            },
            "Weight": "1.0",
            "BillingWeight": {
              "UnitOfMeasurement": {
                "Code": "LBS",
                "Description": "Pounds"
              },
              "Weight": "1.0"
            },
            "ItemizedCharges": [
              {
                "Code": "375",
                "CurrencyCode": "USD",
                "MonetaryValue": "0.00",
                "SubType": "Fuel Surcharge"
              }
            ]
          }
        ],
        "TimeInTransit": {
          "PickupDate": "20230101",
          "PackageBillType": "03",
          "ServiceSummary": {
            "Service": {
              "Description": "UPS Ground"
            },
            "EstimatedArrival": {
              "Arrival": {
                "Date": "20230104",
                "Time": "233000"
              },
              "BusinessDaysInTransit": "2",
              "DayOfWeek": "WED"
            },
            "GuaranteedIndicator": "",
            "Disclaimer": "Services listed as guaranteed..."
          }
        }
      }
    ]
  }
}
```

## Error Response Structure

```json
{
  "response": {
    "errors": [
      {
        "code": "111210",
        "message": "The requested service is unavailable between the selected locations."
      }
    ]
  }
}
```

## HTTP Error Codes
- 400: Invalid Request
- 401: Unauthorized Request
- 403: Blocked Merchant
- 429: Rate Limit Exceeded

## Notes
- All numeric values in responses are strings (MonetaryValue, Weight, etc.)
- RatedShipment is always an array in v2409+
- Service codes are strings, not numbers
- GuaranteedDelivery may be absent for non-guaranteed services
- ItemizedCharges includes surcharges (fuel, residential, etc.)
- TimeInTransit requires DeliveryTimeInformation in request
