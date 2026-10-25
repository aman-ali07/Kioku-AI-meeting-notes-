import { afterEach, describe, expect, it } from "vitest";
import { optionalPositiveIntEnv } from "./env";

const NAME = "KIOKU_TEST_OPTIONAL_INT";

afterEach(() => {
  delete process.env[NAME];
});

describe("optionalPositiveIntEnv", () => {
  it("treats an unset variable as not configured", () => {
    expect(optionalPositiveIntEnv(NAME)).toBeNull();
  });

  it("treats an empty or whitespace value as not configured", () => {
    process.env[NAME] = "";
    expect(optionalPositiveIntEnv(NAME)).toBeNull();

    process.env[NAME] = "   ";
    expect(optionalPositiveIntEnv(NAME)).toBeNull();
  });

  it("parses a positive integer", () => {
    process.env[NAME] = "90";
    expect(optionalPositiveIntEnv(NAME)).toBe(90);
  });

  it.each(["0", "-1", "1.5", "abc", "90days", "1e2", "0x5A"])(
    "rejects invalid value %s",
    (value) => {
      process.env[NAME] = value;
      expect(() => optionalPositiveIntEnv(NAME)).toThrow(
        /expected a positive integer/,
      );
    },
  );
});
