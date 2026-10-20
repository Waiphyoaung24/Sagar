import { expect, test } from "bun:test";
import { formatDuration } from "../../src/lib/duration";

test("elapsed time reads as seconds, then minutes, then hours", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(9)).toBe("9s");
  expect(formatDuration(59)).toBe("59s");
  expect(formatDuration(60)).toBe("1m 0s");
  expect(formatDuration(90)).toBe("1m 30s");
  expect(formatDuration(599)).toBe("9m 59s");
  expect(formatDuration(3600)).toBe("1h 0m 0s");
  expect(formatDuration(3661)).toBe("1h 1m 1s");
  expect(formatDuration(7325)).toBe("2h 2m 5s");
});

test("elapsed time never shows a negative or fractional value", () => {
  expect(formatDuration(-5)).toBe("0s");
  expect(formatDuration(12.9)).toBe("12s");
});
