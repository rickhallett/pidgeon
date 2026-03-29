# Adversarial Review — Response Normalisation (mapResponse)

**Scope:** `response-normalization.test.ts` (new, 10 tests) + `mapResponse` in `rate.ts:86-151`
**Date:** 2026-03-29T17:15:00Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 0 CRITICAL, 1 HIGH, 3 MEDIUM, 3 LOW

---

## HIGH

### [HIGH] CORRECTNESS — GuaranteedIndicator test uses "Y" but UPS may use different truthy values

```
Where: response-normalization.test.ts:58, rate.ts:144
What: The test helper hardcodes GuaranteedIndicator to "Y" for the
      guaranteed=true case (line 58):

        GuaranteedIndicator: overrides.guaranteed ? "Y" : ""

      The implementation checks (line 144):

        guaranteed: timeInTransit.GuaranteedIndicator !== ""

      This means ANY non-empty string is treated as guaranteed=true.
      The test only exercises "Y" as the truthy value. But the UPS API
      reference (docs/ups-api-reference.md:243) shows GuaranteedIndicator
      as an empty string "" in its example — it does NOT document what
      the non-empty value is.

      If UPS uses "1", "true", or a flag character other than "Y",
      the implementation still works (anything non-empty = guaranteed),
      but the test only proves "Y" works. The helper's choice of "Y"
      is an assumption about UPS behaviour that isn't backed by the
      reference docs.

      More critically: what if GuaranteedIndicator is ABSENT (undefined)
      rather than ""? The UPS reference notes (line 278): "GuaranteedDelivery
      may be absent for non-guaranteed services." If UPS omits the field
      entirely, shipment.TimeInTransit.ServiceSummary.GuaranteedIndicator
      is undefined. The !== "" check on undefined evaluates to TRUE,
      meaning a non-guaranteed service would be reported as guaranteed.

Why it matters: Misreporting a non-guaranteed service as guaranteed is
      a material contract error. The caller (checkout UI, comparison engine)
      may show a delivery guarantee that doesn't exist.

Evidence:
      rate.ts:144: timeInTransit.GuaranteedIndicator !== ""
      undefined !== "" → true (JavaScript truthiness)
      UPS API ref: "GuaranteedDelivery may be absent for non-guaranteed services"
      No test covers GuaranteedIndicator being undefined/absent.

Suggested fix: Guard against undefined:
      guaranteed: !!timeInTransit.GuaranteedIndicator
      or:
      guaranteed: timeInTransit.GuaranteedIndicator != null &&
                  timeInTransit.GuaranteedIndicator !== ""
      Add test: shipment where GuaranteedIndicator field is absent
      (not empty string, but undefined/missing from the JSON).
```

---

## MEDIUM

### [MEDIUM] TEST QUALITY — makeRatedShipment hides the raw UPS shape behind a clean abstraction

```
Where: response-normalization.test.ts:23-62
What: The makeRatedShipment helper takes a clean, typed parameter object
      and produces a UPS-shaped payload. This is good for readability but
      creates a coupling risk: if the helper's output shape diverges from
      the real UPS response shape, all 10 tests pass against a shape that
      doesn't exist in production.

      The helper is the ONLY source of test fixtures for the normalisation
      tests. Test 7 (multi-package surcharges, lines 264-303) correctly
      builds a raw shipment instead of using the helper — this is the
      right instinct for edge cases. But the other 9 tests trust the
      helper entirely.

      Specific concerns with the helper:
      - It always produces exactly one RatedPackage entry for surcharges
        (line 44-52). Real UPS responses have one RatedPackage per Package
        in the request. A multi-package request produces multiple
        RatedPackage entries, each with their own ItemizedCharges.
      - It omits fields that exist in real UPS responses:
        Service.Description, TransportationCharges, BaseServiceCharge,
        ServiceOptionsCharges, RatedShipmentAlert, GuaranteedDelivery.
        The mapper may break on a real response if any of these interact
        with the fields it does read.

Why it matters: If the helper produces a shape that's subtly different
      from a real UPS response, the tests validate the wrong contract.
      This is a mild form of "Right Answer, Wrong Work."

Evidence: Compare helper output with docs/ups-api-reference.md:152-248.
      Real response has TransportationCharges, BaseServiceCharge,
      ServiceOptionsCharges, GuaranteedDelivery, RatedShipmentAlert —
      all absent from the helper.

Suggested fix: Not a bug in the code — a test fidelity concern. Consider
      adding one "full fidelity" test that uses a complete UPS response
      payload (all fields from the API reference) to verify the mapper
      handles real-world noise gracefully. The walking skeleton already
      does this partially, but with a single service.
```

### [MEDIUM] CORRECTNESS — Surcharges with MonetaryValue "0.00" are included in the output

```
Where: rate.ts:122-129, docs/ups-api-reference.md:217-224
What: The UPS API reference shows an ItemizedCharge with MonetaryValue
      "0.00" (Fuel Surcharge, line 221). The mapper includes all charges
      regardless of amount — a $0.00 Fuel Surcharge becomes:
        { type: "Fuel Surcharge", amount: 0 }

      This is technically correct (the charge exists, the amount is zero),
      but callers displaying surcharges will show "$0.00 Fuel Surcharge"
      which is confusing. Real UPS responses commonly include zero-value
      charges as informational line items.

      No test verifies the behaviour for zero-value surcharges. The test
      at line 246 ("empty surcharges array when no itemized charges exist")
      tests the ABSENT case, not the ZERO case.

Why it matters: UI-facing callers need to decide whether to display
      zero-value surcharges. If the normalisation layer filters them out,
      callers don't have to. If it passes them through (current behaviour),
      every caller must independently filter. Neither choice is wrong,
      but the behaviour should be tested and intentional.

Evidence: rate.ts:124 — no amount !== 0 check
      UPS API ref line 221: MonetaryValue: "0.00" in example
      No test for this case.

Suggested fix: Add a test with a zero-value surcharge to document the
      current behaviour (pass-through). If filtering is desired, add it
      and test it. Either way, make the behaviour explicit.
```

### [MEDIUM] CORRECTNESS — parseFloat silent rounding on high-precision monetary values

```
Where: rate.ts:101, 124
What: parseFloat("12.36") returns 12.36 exactly because IEEE 754 can
      represent it. But parseFloat("19.999999999999999") returns 20.
      Shipping charges are typically 2 decimal places, but UPS does not
      guarantee precision in its API docs.

      More practically: parseFloat("0.10") + parseFloat("0.20") is
      0.30000000000000004 in JavaScript. If a caller sums surcharges to
      verify they match totalCharge, floating point arithmetic may cause
      a mismatch that isn't a real discrepancy.

      The mapper stores parsed floats directly without rounding to
      2 decimal places.

Why it matters: Downstream comparison (sum of surcharges vs totalCharge)
      or display formatting may produce unexpected results. A charge of
      $2.10 stored as 2.0999999999999996 would display as "$2.10" with
      toFixed(2) but fail a strict equality check.

Evidence: rate.ts:101 — parseFloat(shipment.TotalCharges?.MonetaryValue)
      No rounding step. No test with values known to produce float drift.

Suggested fix: Consider rounding to 2 decimal places:
      Math.round(parseFloat(value) * 100) / 100
      Or document that callers should use toFixed(2) for display.
      Not urgent — UPS typically sends clean 2-decimal values.
```

---

## LOW

### [LOW] API CONTRACT — spec.md RateQuote has estimatedDelivery but core type and mapper omit it

```
Where: spec.md:33, core/src/index.ts:50-60, rate.ts:132-145
What: spec.md defines RateQuote with:
      estimatedDelivery | Date | null | Absolute date
      transitDays       | number | null | Business days

      The core RateQuote type has:
      transitDays: number   (required, not nullable)

      And does NOT have estimatedDelivery at all.

      The UPS response includes EstimatedArrival.Arrival.Date ("20230104")
      and Arrival.Time ("233000") — the data is available but not mapped.

Why it matters: The spec says callers get an absolute delivery date.
      The implementation only gives transit days. A checkout UI that wants
      "Arrives January 4" cannot compute it without knowing the ship date
      (which isn't in the response either, or at least not mapped).

Evidence: spec.md:33 vs core/src/index.ts — field missing from type.
      UPS API ref shows Arrival.Date in ServiceSummary.EstimatedArrival.

Suggested fix: Either add estimatedDelivery to the core type and map
      Arrival.Date/Time, or update the spec to match reality. Divergence
      between spec and implementation should be resolved one way or the other.
```

### [LOW] TEST QUALITY — No test for empty RatedShipment array (zero services)

```
Where: rate.ts:93-96, response-normalization.test.ts
What: The mapper checks if RatedShipment is an array (line 94) but
      doesn't check if it's empty. An empty array [] passes the check,
      the for loop runs zero iterations, and the result is:
        { ok: true, data: [] }

      This is arguably correct (no services available = no quotes), but
      it's an untested edge case. A "Shop" request to UPS between
      unsupported locations might legitimately return an empty array.

Evidence: No test with RatedShipment: [].

Suggested fix: Add a test documenting that an empty RatedShipment
      produces { ok: true, data: [] }. Alternatively, if this should
      be an error ("no rates available"), add validation.
```

### [LOW] TEST QUALITY — Multi-service test destructures with type assertion instead of index access

```
Where: response-normalization.test.ts:117
What: const [ground, secondDay, nextDay] = result.data as [RateQuote, RateQuote, RateQuote];

      This is a tuple assertion on an array. If the mapper returned
      quotes in a different order, the destructuring would silently
      assign the wrong quote to each variable. The test would fail,
      which is correct, but the failure message would be confusing
      ("expected '03', got '01'") rather than pointing to an ordering issue.

      More importantly, the test implicitly asserts that output order
      matches input order. This is currently true (the mapper iterates
      RatedShipment in order) but isn't documented as a contract.

Why it matters: If the mapper ever sorts by price or transit time,
      this test breaks for the wrong reason. The assertion is on
      ordering, not on content.

Evidence: Line 117 — tuple destructure of array return.

Suggested fix: Either assert ordering explicitly (expect the codes
      in order), or look up quotes by serviceCode for order-independent
      assertions. Low priority — current behaviour is fine.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 1 | GuaranteedIndicator undefined ≠ "" — absent field reports as guaranteed |
| MEDIUM | 3 | Helper hides real UPS shape; zero-value surcharges untested; float precision |
| LOW | 3 | Spec divergence on estimatedDelivery; empty array edge case; tuple destructure |

## Trend

The response normalisation tests are well-structured. The `makeRatedShipment` helper and `stubFetchWithResponse` are clean abstractions that make intent obvious. The multi-package surcharge test (line 264) correctly bypasses the helper for a case where the helper's simplification would hide the behaviour under test — good instinct.

The HIGH finding (GuaranteedIndicator undefined vs "") is the most impactful because it's a semantic error with business consequences. JavaScript's `undefined !== ""` being `true` is a classic truthiness trap that turns a missing field into an affirmative claim of guarantee.

The implementation (mapResponse) is unchanged by these tests — the tests are validating existing behaviour, which is the right approach for BUILD_ORDER step 5. The mapper already handles the cases being tested; these tests make implicit behaviour explicit and verifiable.
