import { describe, expect, it } from "vitest";
import { heightPhrase, liftCaption } from "@/lib/coaching/plainHeight";

describe("plain words for how high to lift", () => {
  it("the owner's 130° target reads 'up to head height', with no degrees", () => {
    expect(heightPhrase(130)).toBe("up to head height");
    expect(liftCaption(130)).toBe("Straight arm, up to head height");
    expect(liftCaption(130)).not.toMatch(/\d|°/);
  });
  it("covers the range from below the shoulder to straight up", () => {
    expect(heightPhrase(70)).toBe("almost to shoulder height");
    expect(heightPhrase(90)).toBe("to shoulder height");
    expect(heightPhrase(110)).toBe("just above your shoulder");
    expect(heightPhrase(160)).toBe("high above your head");
    expect(heightPhrase(180)).toBe("straight up above your head");
  });
});

import { targetPhrase } from "@/lib/coaching/plainHeight";
describe("targetPhrase", () => {
  it("arm raises by height, knees by straightness, nothing for sit to stand", () => {
    expect(targetPhrase("rightArmElevationDeg", 130)).toBe("up to head height");
    expect(targetPhrase("bilateralShoulderAbductionDeg", 90)).toBe("to shoulder height");
    expect(targetPhrase("rightKneeExtensionDeg", 170)).toBe("until your leg is straight");
    expect(targetPhrase("rightKneeExtensionDeg", 150)).toBe("most of the way straight");
    expect(targetPhrase("sitToStand", 1)).toBeNull();
  });
});
