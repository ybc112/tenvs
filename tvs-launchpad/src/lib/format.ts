import { formatUnits, parseUnits } from "ethers";

/** wei → 可读数字字符串，保留最多 decimals 位并去尾 0 */
export function fmtNumber(value: bigint | string | number, decimals = 18, maxFrac = 4): string {
  try {
    const raw = formatUnits(BigInt(value), decimals);
    const [int, frac = ""] = raw.split(".");
    if (!frac) return int;
    return `${int}.${frac.slice(0, maxFrac).replace(/0+$/, "")}`;
  } catch {
    return "0";
  }
}

export function fmtPrice(wei: bigint | string | number): string {
  return fmtNumber(wei, 18, 6);
}

/** bps（万分位）→ 百分比字符串 */
export function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

const UNITS = [
  { size: 1e12, label: "T" },
  { size: 1e9, label: "B" },
  { size: 1e6, label: "M" },
  { size: 1e3, label: "K" },
];

/** 大数人类可读缩写（1.2M / 3.4B） */
export function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  for (const u of UNITS) {
    if (abs >= u.size) {
      const n = value / u.size;
      return `${n >= 100 ? Math.round(n) : n.toFixed(1)}${u.label}`;
    }
  }
  return value.toFixed(0);
}

/** 秒 → 人类可读剩余时间 */
export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "已结束";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

export const parseBNB = (value: string) => parseUnits(value || "0", 18);