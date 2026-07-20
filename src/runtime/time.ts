import { z } from "zod";

export const currentTimeInputSchema = z.object({
  timeZone: z.string().trim().min(1).max(100).default("UTC"),
});

export const currentTimeOutputSchema = z.object({
  utcIso: z.string(),
  unixMilliseconds: z.number().int(),
  timeZone: z.string(),
  localDate: z.string(),
  localDateTime: z.string(),
  utcOffset: z.string(),
});

export type CurrentTimeInput = z.input<typeof currentTimeInputSchema>;

export function resolveCurrentTime(
  rawInput: CurrentTimeInput,
  now = new Date(),
): z.infer<typeof currentTimeOutputSchema> {
  const { timeZone } = currentTimeInputSchema.parse(rawInput);
  if (!Number.isFinite(now.getTime())) throw new Error("Current time is unavailable");

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
  } catch {
    throw new Error("timeZone must be a supported IANA time zone");
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  return currentTimeOutputSchema.parse({
    utcIso: now.toISOString(),
    unixMilliseconds: now.getTime(),
    timeZone: formatter.resolvedOptions().timeZone,
    localDate,
    localDateTime: `${localDate}T${parts.hour}:${parts.minute}:${parts.second}`,
    utcOffset: parts.timeZoneName?.replace("GMT", "") || "+00:00",
  });
}
