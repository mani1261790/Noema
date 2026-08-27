const percentFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 1,
  style: "percent"
});

export function formatPercentagePointChange(
  current: number | null,
  previous: number | null
): string | null {
  if (current === null || previous === null) return null;
  const rounded = Math.round((current - previous) * 1_000) / 10;
  if (rounded === 0) return "±0.0ポイント";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(1)}ポイント`;
}

export function describeRateComparison(
  current: number | null,
  previous: number | null,
  days: number
): string {
  const change = formatPercentagePointChange(current, previous);
  return change === null || previous === null
    ? `前の${days}日間との比較データなし`
    : `前の${days}日間 ${percentFormatter.format(previous)} / ${change}`;
}
