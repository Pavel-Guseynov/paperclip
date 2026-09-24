import { describe, expect, it } from "vitest";
import {
  TOOL_CONNECTION_ATTENTION_HEALTH_STATUSES,
  TOOL_CONNECTION_HEALTH_STATUSES,
  TOOL_CONNECTION_SETTLED_HEALTH_STATUSES,
  TOOL_CONNECTION_UNSETTLED_HEALTH_STATUSES,
} from "./constants.js";

describe("tool connection health statuses", () => {
  it("places every declared status in exactly one of settled and unsettled", () => {
    const settled = new Set<string>(TOOL_CONNECTION_SETTLED_HEALTH_STATUSES);
    const unsettled = new Set<string>(TOOL_CONNECTION_UNSETTLED_HEALTH_STATUSES);
    for (const status of TOOL_CONNECTION_HEALTH_STATUSES) {
      expect(settled.has(status) !== unsettled.has(status), status).toBe(true);
    }
    expect(settled.size + unsettled.size).toBe(TOOL_CONNECTION_HEALTH_STATUSES.length);
  });

  it("settles every state that needs attention except an abandoned exchange", () => {
    for (const status of TOOL_CONNECTION_ATTENTION_HEALTH_STATUSES) {
      expect(TOOL_CONNECTION_SETTLED_HEALTH_STATUSES.includes(status), status).toBe(status !== "degraded");
    }
  });
});
