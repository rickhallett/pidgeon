import { Command } from "commander";
import { z } from "zod";
import type { CarrierProvider, RateRequest } from "./index.js";

export type ProgramDeps = {
  readonly provider: CarrierProvider;
  readonly write: (text: string) => void;
};

export function createProgram(deps: ProgramDeps): Command {
  const program = new Command("pidgeon");
  program.exitOverride();
  program.configureOutput({
    writeErr: (str: string) => deps.write(str),
    writeOut: (str: string) => deps.write(str),
  });

  program
    .command("rate")
    .description("Get shipping rate quotes")
    .requiredOption("--origin-street <street>", "Origin street address")
    .requiredOption("--origin-postal <code>", "Origin postal code")
    .requiredOption("--origin-country <code>", "Origin country code")
    .requiredOption("--origin-city <city>", "Origin city")
    .requiredOption("--origin-state <state>", "Origin state")
    .requiredOption("--dest-street <street>", "Destination street address")
    .requiredOption("--dest-postal <code>", "Destination postal code")
    .requiredOption("--dest-country <code>", "Destination country code")
    .requiredOption("--dest-city <city>", "Destination city")
    .requiredOption("--dest-state <state>", "Destination state")
    .requiredOption("--weight <number>", "Package weight")
    .requiredOption("--weight-unit <unit>", "Weight unit (lb, kg)")
    .requiredOption("--length <number>", "Package length")
    .requiredOption("--width <number>", "Package width")
    .requiredOption("--height <number>", "Package height")
    .requiredOption("--dim-unit <unit>", "Dimension unit (in, cm)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const CliNumericSchema = z.coerce.number().positive();
      const parsed = z.object({
        weight: CliNumericSchema,
        length: CliNumericSchema,
        width: CliNumericSchema,
        height: CliNumericSchema,
      }).safeParse({
        weight: opts.weight,
        length: opts.length,
        width: opts.width,
        height: opts.height,
      });

      if (!parsed.success) {
        const errors = parsed.error.issues.map((issue) => `--${issue.path[0]} must be a positive number`);
        deps.write(`Error: ${errors.join("; ")}`);
        return;
      }

      const { weight, length, width, height } = parsed.data;

      const request: RateRequest = {
        origin: {
          street: opts.originStreet,
          postalCode: opts.originPostal,
          countryCode: opts.originCountry,
          city: opts.originCity,
          state: opts.originState,
        },
        destination: {
          street: opts.destStreet,
          postalCode: opts.destPostal,
          countryCode: opts.destCountry,
          city: opts.destCity,
          state: opts.destState,
        },
        packages: [
          {
            weight: { value: weight, unit: opts.weightUnit },
            dimensions: { length, width, height, unit: opts.dimUnit },
          },
        ],
      };

      const result = await deps.provider.getRates(request);

      if (opts.json) {
        if (result.ok) {
          deps.write(JSON.stringify(result.data));
        } else {
          deps.write(JSON.stringify({ ok: false, error: result.error }));
        }
        return;
      }

      if (!result.ok) {
        try {
          program.error(`Error: ${result.error.message}`, { exitCode: 1 });
        } catch {
          // exitOverride throws — expected
        }
        return;
      }

      if (result.data.length === 0) {
        deps.write("No rate quotes found.");
        return;
      }

      for (const quote of result.data) {
        const guaranteed = quote.guaranteed ? " [Guaranteed]" : "";
        const transit = quote.transitDays != null ? `${quote.transitDays} day(s)` : "N/A";
        deps.write(
          `${quote.serviceName}  ${quote.totalCharge.toFixed(2)} ${quote.currency}  ${transit}${guaranteed}`,
        );
      }
    });

  return program;
}
