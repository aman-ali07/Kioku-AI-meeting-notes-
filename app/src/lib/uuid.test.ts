import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a canonical UUID", () => {
    expect(isUuid("38103ece-11ea-48ca-b58d-cbe4b299608a")).toBe(true);
    expect(isUuid("38103ECE-11EA-48CA-B58D-CBE4B299608A")).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "------------------------------------", // 36 hyphens: the old export regex accepted this
    "38103ece11ea48cab58dcbe4b299608a",
    "{38103ece-11ea-48ca-b58d-cbe4b299608a}",
    "38103ece-11ea-48ca-b58d-cbe4b299608a-extra",
  ])("rejects malformed value %j", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
