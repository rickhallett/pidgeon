import { describe, it, expect } from "bun:test";
import { WeightSchema, DimensionsSchema } from "./schemas.js";

describe("WeightSchema", () => {
  it("accepts known weight units", () => {
    for (const unit of ["lb", "kg", "oz", "g"]) {
      const result = WeightSchema.safeParse({ value: 1, unit });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown weight units", () => {
    const result = WeightSchema.safeParse({ value: 1, unit: "stones" });
    expect(result.success).toBe(false);
  });
});

describe("DimensionsSchema", () => {
  it("accepts known dimension units", () => {
    for (const unit of ["in", "cm", "mm"]) {
      const result = DimensionsSchema.safeParse({ length: 1, width: 1, height: 1, unit });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown dimension units", () => {
    const result = DimensionsSchema.safeParse({ length: 1, width: 1, height: 1, unit: "furlongs" });
    expect(result.success).toBe(false);
  });
});
