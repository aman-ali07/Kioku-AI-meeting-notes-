import { describe, expect, it } from "vitest";
import { canWriteToWorkspace } from "./workspace-role";

describe("canWriteToWorkspace", () => {
  it("allows owners and members", () => {
    expect(canWriteToWorkspace("owner")).toBe(true);
    expect(canWriteToWorkspace("member")).toBe(true);
  });

  it("denies viewers", () => {
    expect(canWriteToWorkspace("viewer")).toBe(false);
  });
});
