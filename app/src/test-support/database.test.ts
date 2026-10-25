import { describe, expect, it } from "vitest";
import { assertTestDatabaseName } from "./database";

describe("assertTestDatabaseName", () => {
  it("accepts databases ending in _test", () => {
    expect(() => assertTestDatabaseName("kioku_test")).not.toThrow();
  });

  it.each(["kioku", "kioku_test_backup", ""])(
    "refuses %j",
    (name) => {
      expect(() => assertTestDatabaseName(name)).toThrow(
        /use a \*_test database/,
      );
    },
  );
});
