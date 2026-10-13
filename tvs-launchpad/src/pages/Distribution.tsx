import { useCallback, useState } from "react";
import { Contract, formatUnits } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import { SectionTitle, ProgressBar, AddressChip } from "../components/ui";
import { config, distributorConfig, fmtAddress } from "../config";
import { distributorAbi } from "../lib/chain";
import { fmtNumber } from "../lib/format";
import { distributorReady, useDistributorSchedules, type ScheduleView } from "../lib/distribution";

/** 占位空态：合约未部署时不发任何 RPC 请求 */
function Placeholder() {
  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <span className="kicker">ISSUE 06 · Token Distribution</span>
      <h1 style={{ marginTop: 12 }}>
        代币<em className="em-gold">分发</em>
      </h1>
      <div className="banner" style={{ marginTop: 28 }}>
        <span className="banner-mark">‡</span>
        <div>
          <h4>占位模式 · 分发合约待部署</h4>
          <p>
            分发合约尚未接入主网（测试网部署记录见
            <span className="mono"> vsa-staking/deployments/testnet.json</span>）。部署后将合约地址填入
            <span className="mono"> distributorConfig.distributor </span>并置
            <span className="mono"> distributorReady = true </span>即可启用。
          </p>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: "16px 18px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)" }}>
      <div className="kicker" style={{ fontSize: 11 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, color: "var(--gold-l)", marginTop: 8 }}>{value}</div>
      {sub && <div className="serif" style={{ fontSize: 12, color: "var(--gray-d)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const fmt = (v: bigint) => fmtNumber(v, 18, 2);
const fmtDate = (ts: number) =>
  ts > 0 ? new Date(ts * 1000).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

const fmtDur = (sec: number) => {
  if (sec === 0) return "无";
  const d = Math.round(sec / 86400);
  return d >= 1 ? `${d} 天` : `${sec} 秒`;
};

/** 释放阶段：未开始 / 锁定期 / 线性中 / 已完结 */
function phaseOf(s: ScheduleView, now: number): { tag: string; done: boolean } {
  if (s.revoked) return { tag: "已撤销", done: true };
  const cliffEnd = s.start + s.cliff;
  const end = s.linearDuration === 0 ? cliffEnd : cliffEnd + s.linearDuration;
  if (now < s.start) return { tag: "未开始", done: false };
  if (now >= end) return { tag: "已完结", done: true };
  if (now < cliffEnd) return { tag: "锁定期", done: false };
  return { tag: "线性释放中", done: false };
}

function ScheduleCard({
  s,
  now,
  account,
  owner,
  busy,
  onRelease,
  onRevoke,
}: {
  s: ScheduleView;
  now: number;
  account: string | null;
  owner: string;
  busy: string;
  onRelease: (id: number) => void;
  onRevoke: (id: number) => void;
}) {
  const releasable = s.revoked ? 0n : s.vested - s.released;
  const phase = phaseOf(s, now);
  const pct = s.total === 0n ? 0 : Number((s.released * 10000n) / s.total);
  const isBeneficiary = !!account && account.toLowerCase() === s.beneficiary.toLowerCase();
  const isOwner = !!account && owner !== "" && account.toLowerCase() === owner.toLowerCase();

  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="kicker" style={{ fontSize: 11 }}>
            #{s.id} · {s.roleLabel || "未命名角色"}
            {!s.revocable && " · 不可撤销"}
          </span>
          <div className="mono" style={{ fontSize: 17, marginTop: 4 }}>
            {fmt(s.total)} <span style={{ color: "var(--gray-d)", fontSize: 12 }}>份额总量</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`pc-status ${phase.done ? "done" : ""}`}>{phase.tag}</span>
          <div className="serif" style={{ fontSize: 12, color: "var(--gray-d)", marginTop: 6 }}>
            受益人 <AddressChip address={s.beneficiary} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <ProgressBar value={pct} />
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
        <span className="serif" style={{ fontSize: 12, color: "var(--gray-d)" }}>
          已释放 {fmt(s.released)} / 已解锁 {fmt(s.vested)}
        </span>
        <span className="serif" style={{ fontSize: 12, color: "var(--gray-d)" }}>
          TGE {s.tgeBps / 100}% ｜ Cliff {fmtDur(s.cliff)} ｜ 线性 {fmtDur(s.linearDuration)}
        </span>
        <span className="serif" style={{ fontSize: 12, color: "var(--gray-d)" }}>
          {fmtDate(s.start)} → {fmtDate(s.linearDuration === 0 ? s.start + s.cliff : s.start + s.cliff + s.linearDuration)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
        <button
          className="btn btn-sm btn-gold"
          disabled={busy !== "" || releasable === 0n}
          onClick={() => onRelease(s.id)}
          title={isBeneficiary ? "领取已解锁部分" : "任何人可触发，代币发往受益人"}
        >
          领取可解锁（{fmt(releasable)}）
        </button>
        {isOwner && s.revocable && !s.revoked && (
          <button
            className="btn btn-sm"
            style={{ borderColor: "var(--red)", color: "var(--red)" }}
            disabled={busy !== ""}
            onClick={() => onRevoke(s.id)}
            title="已解锁未领部分发给受益人，未解锁部分退回金库"
          >
            撤销结清
          </button>
        )}
        {!isOwner && s.revocable && !s.revoked && owner && (
          <span className="serif" style={{ fontSize: 12, color: "var(--gray-d)" }}>
            撤销操作仅限治理方 {fmtAddress(owner)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Distribution() {
  const { account, signer, chainId, connect } = useWallet();
  const toast = useToast();
  const { schedules, owner, refresh } = useDistributorSchedules();
  const [busy, setBusy] = useState("");

  const ready = distributorReady();
  const now = Math.floor(Date.now() / 1000);

  const totals = schedules.reduce(
    (acc, s) => {
      acc.total += s.total;
      acc.released += s.released;
      acc.vested += s.vested;
      return acc;
    },
    { total: 0n, released: 0n, vested: 0n },
  );
  const claimableAll = schedules.reduce((a, s) => (s.revoked ? a : a + (s.vested - s.released)), 0n);
  const overallPct = totals.total === 0n ? 0 : Number((totals.released * 10000n) / totals.total);

  const run = async (key: string, fn: (s: JsonRpcSigner) => Promise<{ hash: string }>, okMsg: string) => {
    if (!account || !signer) {
      await connect();
      return;
    }
    if (chainId !== config.chainId) {
      toast(
        `请切换到 ${config.nativeSymbol} ${config.chainId === 97 ? "测试网" : "主网"}（Chain ${config.chainId}）`,
        "err",
      );
      return;
    }
    setBusy(key);
    try {
      const { hash } = await fn(signer);
      toast("交易已广播…", "info");
      await new Promise((r) => setTimeout(r, 1500));
      toast(`${okMsg} ✓ ${hash.slice(0, 10)}…`, "ok");
      await refresh();
    } catch (e) {
      const msg =
        (e as { shortMessage?: string }).shortMessage ||
        (e as Error).message ||
        (e as { reason?: string }).reason ||
        "";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(`失败: ${String(msg).slice(0, 140)}`, "err");
    } finally {
      setBusy("");
    }
  };

  const doRelease = (id: number) =>
    run(
      `release-${id}`,
      async (s) => {
        const dist = new Contract(distributorConfig.distributor, distributorAbi, s);
        const tx = await (dist.release as (i: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(
          id,
        );
        await tx.wait();
        return { hash: tx.hash };
      },
      `日程 #${id} 领取成功`,
    );

  const doRevoke = (id: number) =>
    run(
      `revoke-${id}`,
      async (s) => {
        const dist = new Contract(distributorConfig.distributor, distributorAbi, s);
        const tx = await (dist.revoke as (i: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(
          id,
        );
        await tx.wait();
        return { hash: tx.hash };
      },
      `日程 #${id} 已撤销结清`,
    );

  if (!ready) return <Placeholder />;

  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
        <span className="kicker">ISSUE 06 · Token Distribution</span>
        <span className="serif" style={{ color: "var(--gray-d)", fontSize: 15 }}>TGE 锁仓 · 按日程释放</span>
      </div>
      <h1 style={{ marginBottom: 18 }}>
        代币<em className="em-gold">分发</em>
      </h1>
      <p className="serif" style={{ color: "var(--gray)", fontSize: 16, maxWidth: 720, marginBottom: 12 }}>
        TGE 预留份额锁入分发合约，各多签按「TGE 即时 + Cliff + 线性」日程领取。
        释放比例写死在合约里，任何人可在浏览器核验剩余额度与解锁时间。
      </p>
      <p className="serif" style={{ color: "var(--gray-d)", fontSize: 14, maxWidth: 720, marginBottom: 36 }}>
        治理多签可对可撤销日程执行「撤销结清」：已解锁未领部分发给受益人，未解锁部分退回金库。
      </p>

      {/* ===== 全局数据 ===== */}
      <SectionTitle number="01" title="分发总览" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, margin: "18px 0 20px" }}>
        <Stat label="日程数" value={String(schedules.length)} />
        <Stat label="锁仓总量" value={fmt(totals.total)} />
        <Stat label="已释放" value={fmt(totals.released)} sub={`总进度 ${overallPct / 100}%`} />
        <Stat label="已解锁未领" value={fmt(claimableAll)} sub="随时可领取" />
        <Stat label="锁仓中" value={fmt(totals.vested - totals.released > 0n ? totals.vested - totals.released : 0n)} sub="按日程逐步解锁" />
      </div>
      <div style={{ marginBottom: 36 }}>
        <ProgressBar value={overallPct} />
      </div>

      {/* ===== 日程明细 ===== */}
      <SectionTitle number="02" title="释放日程" />
      <div style={{ margin: "12px 0" }}>
        {schedules.length === 0 ? (
          <p className="serif" style={{ color: "var(--gray-d)", fontSize: 14 }}>暂无日程。</p>
        ) : (
          schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              s={s}
              now={now}
              account={account}
              owner={owner}
              busy={busy}
              onRelease={(id) => void doRelease(id)}
              onRevoke={(id) => void doRevoke(id)}
            />
          ))
        )}
      </div>

      {/* ===== 角色对照 ===== */}
      <SectionTitle number="03" title="多签角色" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, margin: "18px 0" }}>
        {distributorConfig.roles.map((r) => (
          <div key={r.address + r.label} style={{ padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)" }}>
            <div className="kicker" style={{ fontSize: 11 }}>{r.label}</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>{fmtAddress(r.address)}</div>
          </div>
        ))}
      </div>
      <p className="serif" style={{ color: "var(--gray-d)", fontSize: 13, marginBottom: 24 }}>
        治理方（社区自治核心多签）持有分发合约 owner 权限：可创建/撤销日程、回收误入代币（不可触及受益人未清义务）。
      </p>
      <p className="serif" style={{ color: "var(--gray-d)", fontSize: 13 }}>
        合约内代币单位：{formatUnits(1n, 18)}（18 位小数）。
      </p>
    </section>
  );
}
