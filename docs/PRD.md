# PRD: Carrier Integration Service

> Source: Cybership Backend Engineering Take-Home Assessment

## Problem

Cybership integrates with shipping carriers to provide customers with real-time rates, labels, tracking, and more. We need a shipping carrier integration service in TypeScript that wraps the UPS Rating API to fetch shipping rates — designed as a real, maintainable production module that the team extends over time to support additional carriers (FedEx, USPS, DHL) and additional operations (label purchase, tracking, address validation).

## Constraints

- **Language:** TypeScript (required)
- **Time budget:** 2-4 hours. Quality and thoughtfulness over completeness.
- **No live API:** No UPS developer credentials provided. Stub/mock HTTP calls. Code should be structurally correct and demonstrate understanding of the UPS API from its documentation.
- **No UI:** Backend/service-layer only. Test suite or simple CLI demonstrating usage is sufficient.
- **UPS API reference:** https://developer.ups.com/tag/Rating?loc=en_US

## Requirements

### R1 — Rate Shopping

Accept a rate request (origin, destination, package dimensions/weight, optional service level) and return normalized rate quote(s). The caller should never need to know anything about UPS's raw request or response format.

### R2 — Authentication

Implement the UPS OAuth 2.0 client-credentials flow: token acquisition, caching/reuse of valid tokens, and transparent refresh on expiry.

### R3 — Extensible Architecture

Adding a second carrier or a second UPS operation should not require rewriting existing code. Clear pattern for how new carriers and operations plug in. Do not hardcode to only support the single rate endpoint.

### R4 — Configuration

All secrets and environment-specific values must come from environment variables or a configuration layer — never hardcoded. Include a `.env.example`.

### R5 — Types and Validation

Strong TypeScript types and runtime validation schemas for all domain models (requests, responses, addresses, packages, errors). Validate input before making any external call.

### R6 — Error Handling

Handle realistic failure modes: network timeouts, HTTP error codes, malformed responses, rate limiting, auth failures. Errors returned to the caller should be meaningful and structured.

### R7 — Integration Tests (Critical)

Write integration tests that exercise the service's logic end-to-end using stubbed API responses based on payloads from the UPS documentation. Tests must verify:

- Request payloads are correctly built from domain models
- Successful responses are parsed and normalized into internal types
- Auth token lifecycle works (acquisition, reuse, refresh on expiry)
- Error responses (4xx, 5xx, malformed JSON, timeouts) produce expected structured errors

Stub the HTTP layer and feed it realistic payloads so processing logic — parsing, mapping, validation, and error handling — all works as expected without a live API.

## Evaluation Criteria

| Criteria | What They Look For |
|---|---|
| Architecture and Extensibility | Clean separation of concerns. Could we add FedEx without touching UPS code? |
| Types and Domain Modeling | Well-defined domain objects. Clear boundary between internal and external API shapes. |
| Auth Implementation | Token lifecycle management transparent to the caller. |
| Error Handling | Structured, actionable errors. No swallowed exceptions. |
| Integration Tests | Stubbed end-to-end tests proving request building, response parsing, and error paths. |
| Code Quality | Readability, naming, idiomatic TypeScript. Comments where intent isn't obvious. |

## Deliverables

1. A GitHub repository (public, under own account)
2. A `README.md` explaining design decisions, how to run the project, and what would be improved given more time
3. A `.env.example` listing required environment variables

## Contact

Questions: Jack at jack@cybership.io
