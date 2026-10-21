// pandas describe() for a list of numbers: count, mean, std (ddof=1), min,
// quartiles with linear interpolation, max. Nulls are skipped like in pandas.
export type Describe = Record<"count" | "mean" | "std" | "min" | "25%" | "50%" | "75%" | "max", number | null>;

export const DESCRIBE_KEYS = ["count", "mean", "std", "min", "25%", "50%", "75%", "max"] as const;

export function describe(values: (number | null)[]): Describe {
  const xs = values.filter((v): v is number => v !== null && !Number.isNaN(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) {
    return { count: 0, mean: null, std: null, min: null, "25%": null, "50%": null, "75%": null, max: null };
  }
  const mean = xs.reduce((sum, v) => sum + v, 0) / n;
  const variance = n > 1 ? xs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : NaN;
  const quantile = (q: number) => {
    const pos = (n - 1) * q;
    const low = Math.floor(pos);
    const high = Math.ceil(pos);
    return xs[low] + (xs[high] - xs[low]) * (pos - low);
  };
  return {
    count: n,
    mean,
    std: Number.isNaN(variance) ? null : Math.sqrt(variance),
    min: xs[0],
    "25%": quantile(0.25),
    "50%": quantile(0.5),
    "75%": quantile(0.75),
    max: xs[n - 1],
  };
}
