import { describe, expect, it } from "vitest";

import { resolveCurrentTime } from "@/src/runtime/time";

describe("trusted runtime time", () => {
  const now = new Date("2026-07-19T23:23:03.576Z");

  it("returns UTC and the requested local calendar date", () => {
    expect(resolveCurrentTime({ timeZone: "America/New_York" }, now)).toEqual({
      utcIso: "2026-07-19T23:23:03.576Z",
      unixMilliseconds: 1_784_503_383_576,
      timeZone: "America/New_York",
      localDate: "2026-07-19",
      localDateTime: "2026-07-19T19:23:03",
      utcOffset: "-04:00",
    });
  });

  it("defaults to UTC", () => {
    expect(resolveCurrentTime({}, now)).toMatchObject({
      timeZone: "UTC",
      localDate: "2026-07-19",
      localDateTime: "2026-07-19T23:23:03",
      utcOffset: "+00:00",
    });
  });

  it("rejects unsupported time zones", () => {
    expect(() => resolveCurrentTime({ timeZone: "Mars/Olympus" }, now)).toThrow(
      "supported IANA time zone",
    );
  });
});
