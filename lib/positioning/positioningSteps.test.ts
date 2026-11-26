import { describe, expect, it } from "vitest";
import { positioningSteps } from "@/lib/positioning/positioningSteps";

const statuses = (id: string | null, locked = false) => positioningSteps(id, locked).map((s) => s.status);

describe("positioningSteps", () => {
  it("not seen yet: the first step is being worked on", () => {
    expect(statuses("no_person")).toEqual(["now", "todo", "todo", "todo", "todo"]);
  });
  it("too close: seen and facing are done, fitting in is now", () => {
    expect(statuses("too_close")).toEqual(["done", "done", "now", "todo", "todo"]);
  });
  it("camera tilt counts as fitting in", () => {
    expect(statuses("tilt_down")).toEqual(["done", "done", "now", "todo", "todo"]);
  });
  it("holding still: everything else is done", () => {
    expect(statuses("hold_still")).toEqual(["done", "done", "done", "done", "now"]);
  });
  it("placed: every step done", () => {
    expect(statuses(null, true)).toEqual(["done", "done", "done", "done", "done"]);
  });
  it("an unknown issue starts at the top rather than claiming progress", () => {
    expect(statuses("something_new")).toEqual(["now", "todo", "todo", "todo", "todo"]);
  });
});
