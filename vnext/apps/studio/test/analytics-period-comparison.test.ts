import { describe, expect, it } from "vitest";
import {
  describeRateComparison,
  formatPercentagePointChange
} from "../src/analytics-period-comparison";

describe("analytics period comparison", () => {
  it("formats rate movement as percentage-point change", () => {
    expect(formatPercentagePointChange(0.5, 0.25)).toBe("+25.0ポイント");
    expect(formatPercentagePointChange(0.25, 0.5)).toBe("−25.0ポイント");
    expect(formatPercentagePointChange(0.3334, 0.3333)).toBe("±0.0ポイント");
  });

  it("does not invent a comparison when either denominator is missing", () => {
    expect(formatPercentagePointChange(null, 0.25)).toBeNull();
    expect(formatPercentagePointChange(0.25, null)).toBeNull();
    expect(describeRateComparison(0.25, null, 30)).toBe("前の30日間との比較データなし");
  });

  it("includes the previous rate and selected period", () => {
    expect(describeRateComparison(0.5, 0.25, 7)).toBe("前の7日間 25% / +25.0ポイント");
  });
});
