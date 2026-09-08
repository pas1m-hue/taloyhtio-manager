import { describe, expect, it } from "vitest";
import { instantIso, instantMillis, integer } from "./postgresValues.js";

describe("instantMillis", () => {
  it("keeps the milliseconds a Date column carries", () => {
    // The bug this module was created for. node-postgres returns timestamptz
    // as a Date, and the session repository compared it with
    // `Date.parse(String(value))` — Date.prototype.toString() has second
    // precision, so a payload written from new Date().toISOString() never
    // matched its own stored column and every visitor session was rejected as
    // corrupt. Reproduced here so the reasoning outlives the fix.
    const iso = "2026-09-05T11:43:38.744Z";
    const stored = new Date(iso);

    expect(instantMillis(stored, "created_at")).toBe(Date.parse(iso));
    expect(Date.parse(String(stored))).not.toBe(Date.parse(iso));
  });

  it("agrees between a payload string and the Date it was stored as", () => {
    const iso = "2026-07-17T20:00:00.317+03:00";
    expect(instantMillis(iso, "payload"))
      .toBe(instantMillis(new Date(iso), "row"));
  });

  it("reads PostgreSQL's own text format, offset and all", () => {
    // A space instead of "T", and a two-digit offset where ECMAScript wants
    // "+03:00". Some drivers hand timestamps back this way.
    expect(instantMillis("2026-09-05 11:43:38.744+00", "created_at"))
      .toBe(Date.parse("2026-09-05T11:43:38.744Z"));
    expect(instantMillis("2026-09-05 11:43:38.744+03", "created_at"))
      .toBe(Date.parse("2026-09-05T11:43:38.744+03:00"));
  });

  it("needs both normalisation steps, in that order", () => {
    // V8 happens to accept the space-separated form, so replacing " " with "T"
    // alone would turn a parseable string into an unparseable one: with a "T"
    // the bare two-digit offset is rejected. Neither step is redundant, and
    // dropping either one silently breaks non-UTC offsets.
    expect(Number.isNaN(Date.parse("2026-09-05T11:43:38.744+03"))).toBe(true);
    expect(instantMillis("2026-09-05 11:43:38.744+03", "created_at"))
      .toBe(1_788_597_818_744);
  });

  it("names the column when a stored timestamp is unusable", () => {
    expect(() => instantMillis("not a timestamp", "session row created_at"))
      .toThrow(/session row created_at/);
    expect(() => instantMillis(new Date(Number.NaN), "session row expires_at"))
      .toThrow(/session row expires_at/);
  });
});

describe("instantIso", () => {
  it("round-trips milliseconds rather than truncating them", () => {
    expect(instantIso(new Date("2026-07-01T10:00:00.108Z"), "granted_at"))
      .toBe("2026-07-01T10:00:00.108Z");
  });

  it("normalises an offset to UTC without losing the instant", () => {
    expect(instantIso("2026-07-17T20:00:00.317+03:00", "expires_at"))
      .toBe("2026-07-17T17:00:00.317Z");
  });
});

describe("integer", () => {
  it("accepts the string form a bigint column arrives in", () => {
    expect(integer("41", "admin revision")).toBe(41);
    expect(integer(41, "admin revision")).toBe(41);
  });

  it("rejects anything that is not a safe integer, naming the column", () => {
    expect(() => integer("9007199254740993", "session revision"))
      .toThrow(/session revision/);
    expect(() => integer(1.5, "session revision")).toThrow(/session revision/);
    expect(() => integer("abc", "publication version")).toThrow(/publication version/);
  });

  it("does not reject null, which Number() turns into 0", () => {
    // Documented rather than fixed: this laxness came from both original
    // copies and every column it reads is NOT NULL, so no caller can reach it
    // today. Pinned here so a future change to the schema does not discover it
    // the way the timestamp truncation was discovered.
    expect(integer(null, "session revision")).toBe(0);
  });
});
