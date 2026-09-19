import type { ReactNode } from "react";
import { fmtAddress } from "../config";

/** 编辑版眉题：编号 + 标题 + 副文 */
export function SectionTitle({
  number,
  title,
  intro,
}: {
  number: string;
  title: ReactNode;
  intro?: ReactNode;
}) {
  return (
    <div className="section-head">
      <span className="kicker">{number}</span>
      <h2>{title}</h2>
      {intro && <p className="serif" style={{ color: "var(--paper-2)", fontSize: 15, marginTop: 14, maxWidth: 620, lineHeight: 1.9 }}>{intro}</p>}
    </div>
  );
}

/** 跑马灯 */
export function Ticker({ items }: { items: string[] }) {
  const track = [...items, ...items];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {track.map((item, i) => (
          <span key={i}>{item}</span>
        ))}
      </div>
    </div>
  );
}

/** 发丝进度条（bps / 万分位） */
export function ProgressBar({ value, max = 10000 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 复制地址 */
export function AddressChip({
  address,
  suffix,
  link,
  length = "short",
}: {
  address: string;
  suffix?: string;
  link?: string;
  length?: "short" | "full";
}) {
  const display = length === "short" ? fmtAddress(address) : address;
  const inner = (
    <span
      className="addr"
      title="点击复制"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard?.writeText(address).catch(() => {});
      }}
    >
      {display}
      {suffix && <span style={{ color: "var(--gold)" }}>{suffix}</span>}
    </span>
  );
  if (!link) return inner;
  return (
    <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {inner}
    </a>
  );
}

/** 卡片骨架 */
export function CardSkeleton() {
  return (
    <div className="project-card">
      <div className="pc-head">
        <span className="pc-no">···</span>
        <span className="skeleton" style={{ width: 64, height: 14 }} />
      </div>
      <div className="pc-body">
        <div className="pc-avatar skeleton" />
        <div style={{ flex: 1 }}>
          <div className="skeleton" style={{ width: "55%", height: 16, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "35%", height: 10 }} />
        </div>
      </div>
      <div className="skeleton" style={{ width: "80%", height: 10 }} />
    </div>
  );
}

/** 状态徽章 */
export function StatusBadge({ status }: { status: string }) {
  if (status === "open") return <span className="pc-status live">● LIVE</span>;
  if (status === "soldout") return <span className="pc-status">SOLD OUT</span>;
  if (status === "refunding")
    return <span className="pc-status" style={{ color: "var(--red)", borderColor: "var(--red)" }}>REFUND</span>;
  if (status === "finalized") return <span className="pc-status done">LOCKED</span>;
  return <span className="pc-status">—</span>;
}