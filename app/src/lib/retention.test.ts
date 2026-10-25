import { describe, expect, it } from "vitest";
import { formatRetention } from "./retention";

describe("formatRetention", () => {
  it("renders NULL as forever (self-host default)", () => {
    expect(formatRetention(null)).toBe("Forever");
  });

  it("renders day counts with correct pluralization", () => {
    expect(formatRetention(1)).toBe("1 day");
    expect(formatRetention(90)).toBe("90 days");
  });
});
