import { z } from "zod";

export const WeightSchema = z.object({
  value: z.number().positive(),
  unit: z.string().min(1),
});

export const DimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.string().min(1),
});

export const PackageSchema = z.object({
  weight: WeightSchema,
  dimensions: DimensionsSchema,
});

export const AddressSchema = z.object({
  street: z.string().min(1),
  postalCode: z.string().min(1),
  countryCode: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
});

export const RateRequestSchema = z.object({
  origin: AddressSchema,
  destination: AddressSchema,
  packages: z.array(PackageSchema).min(1).readonly(),
  serviceCode: z.string().optional(),
});

export type Address = z.infer<typeof AddressSchema>;
export type Weight = z.infer<typeof WeightSchema>;
export type Dimensions = z.infer<typeof DimensionsSchema>;
export type Package = z.infer<typeof PackageSchema>;
export type RateRequest = z.infer<typeof RateRequestSchema>;
