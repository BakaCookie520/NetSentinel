import { describe, expect, it } from "vitest";
import { advanceMonitorState } from "../src/index.js";

describe("monitor state transitions", () => {
  it("opens an incident only after three consecutive failures", () => {
    let state = { status: "UP" as const, consecutiveFailures: 0, consecutiveSuccesses: 2 };
    const first = advanceMonitorState(state, false);
    expect(first).toEqual({ state: { status: "DEGRADED", consecutiveFailures: 1, consecutiveSuccesses: 0 }, transition: null });
    const second = advanceMonitorState(first.state, false);
    expect(second.transition).toBeNull();
    const third = advanceMonitorState(second.state, false);
    expect(third).toEqual({ state: { status: "DOWN", consecutiveFailures: 3, consecutiveSuccesses: 0 }, transition: "DOWN" });
  });

  it("recovers only after two consecutive successes", () => {
    const first = advanceMonitorState({ status: "DOWN", consecutiveFailures: 3, consecutiveSuccesses: 0 }, true);
    expect(first).toEqual({ state: { status: "DOWN", consecutiveFailures: 0, consecutiveSuccesses: 1 }, transition: null });
    const second = advanceMonitorState(first.state, true);
    expect(second).toEqual({ state: { status: "UP", consecutiveFailures: 0, consecutiveSuccesses: 2 }, transition: "RECOVERY" });
  });

  it("keeps paused monitors paused", () => {
    expect(advanceMonitorState({ status: "PAUSED", consecutiveFailures: 0, consecutiveSuccesses: 0 }, false).state.status).toBe("PAUSED");
  });
});
