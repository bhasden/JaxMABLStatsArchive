import assert from "node:assert/strict";
import test from "node:test";
import {
  PointstreakRequestError,
  buildPointstreakRetryBackoffMs,
  parseRetryAfterMs,
  randomRequestDelayMs,
} from "./pointstreak-archive";

test("parseRetryAfterMs handles seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("7", 0), 7000);
  assert.equal(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:10 GMT", 0), 10000);
  assert.equal(parseRetryAfterMs(null, 0), null);
});

test("randomRequestDelayMs stays within the requested range", () => {
  for (let index = 0; index < 50; index += 1) {
    const delay = randomRequestDelayMs(500, 1500);
    assert.ok(delay >= 500 && delay <= 1500);
  }
});

test("buildPointstreakRetryBackoffMs honors retry-after when present", () => {
  const error = new PointstreakRequestError(429, "Too Many Requests", 4000);
  const delay = buildPointstreakRetryBackoffMs(2, error, 500, 1500);
  assert.ok(delay >= 4500 && delay <= 5500);
});

test("buildPointstreakRetryBackoffMs increases aggressively for throttling errors", () => {
  const throttleDelay = buildPointstreakRetryBackoffMs(
    3,
    new PointstreakRequestError(429, "Too Many Requests"),
    500,
    1500,
  );
  const genericDelay = buildPointstreakRetryBackoffMs(3, new Error("boom"), 500, 1500);

  assert.ok(throttleDelay > genericDelay);
});
