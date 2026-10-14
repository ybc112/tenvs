import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, MaxUint256, formatUnits, parseUnits } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import { SectionTitle, ProgressBar, AddressChip } from "../components/ui";
import { EXPLORER_BASE, config, stakingConfig } from "../config";
import { stakingAbi } from "../lib/chain";
import { ERC20_ABI } from "../lib/swap";
import { fmtNumber, fmtCountdown } from "../lib/format";
import { TERMS, stakingReady, useMyStaking, useStakingStats, type StakeRecordView } from "../lib/staking";

/** 占位空态：合约未部署时不发任何 RPC 请求 */
function Placeholder() {
  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <span className="kicker">ISSUE 05 · VSA Staking</span>
      <h1 style={{ marginTop: 12 }}>VSA <em className="em-gold">质押挖矿</em></h1>
      <div className="banner" style={{ marginTop: 28 }}>
        <span className="banner-mark">‡</span>
        <div>
          <h4>占位模式 · 质押合约待部署</h4>
          <p>
            质押挖矿合约尚未就绪（合约或 VSA 代币部署中）。部署后将质押合约地址填入
            <span className="mono"> stakingConfig.staking </span>并置 <span className="mono">stakingReady = true</span> 即可启用。
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

function StakeRow({
  s,
  now,
  busy,
  onUnstake,
  onEmergency,
}: {
  s: StakeRecordView;
  now: number;
  busy: string;
  onUnstake: (id: number) => void;
  onEmergency: (id: number) => void;
}) {
  const term = TERMS[s.termIdx] ?? TERMS[0];
  const matured = now >= s.maturityTime;
  const remain = s.maturityTime - now;
  const kind = s.isVsa ? "VSA 本金" : "TVS 本金";

  if (!s.active) {
    return (
      <div className="dl-row" style={{ opacity: 0.5 }}>
        <span>#{s.id} · {term.label} · {kind}</span>
        <b className="mono">已解押</b>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="kicker" style={{ fontSize: 11 }}>#{s.id} · {term.label} · {term.weightLabel}</span>
          <div className="mono" style={{ fontSize: 17, marginTop: 4 }}>
            {fmtNumber(s.principal, 18, 6)} <span style={{ color: "var(--gray-d)", fontSize: 12 }}>{kind}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`pc-status ${matured ? "done" : ""}`}>{matured ? "可解押" : "锁定期中"}</span>
          <div className="serif" style={{ fontSize: 12, color: "var(--gray-d)", marginTop: 6 }}>
            {matured ? "已到期" : `剩余 ${fmtCountdown(remain)}`}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button className="btn btn-sm btn-gold" disabled={!matured || busy !== ""} onClick={() => onUnstake(s.id)}>
          解押本金
        </button>
        <button
          className="btn btn-sm"
          style={{ borderColor: "var(--red)", color: "var(--red)" }}
          disabled={matured || busy !== ""}
          onClick={() => onEmergency(s.id)}
        >
          强行解除
        </button>
      </div>
    </div>
  );
}

export default function Stake() {
  const { account, signer, chainId, connect } = useWallet();
  const toast = useToast();
  const { stats, refresh: refreshStats } = useStakingStats();
  const { mine, refresh: refreshMine } = useMyStaking(account);

  const [termIdx, setTermIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [txHash, setTxHash] = useState("");
  const [tvsBal, setTvsBal] = useState<bigint>(0n);
  const [vsaBal, setVsaBal] = useState<bigint>(0n);
  const [reinvestTerm, setReinvestTerm] = useState(0);
  const [confirmEmg, setConfirmEmg] = useState<number | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  const ready = stakingReady();

  // 秒级心跳（倒计时用）
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const loadBalances = useCallback(async () => {
    if (!ready || !account) return;
    try {
      const tvs = new Contract(stakingConfig.tvs, ERC20_ABI, signer ?? undefined);
      const [b, v] = await Promise.all([
        tvs.balanceOf(account) as Promise<bigint>,
        stakingConfig.vsa
          ? (new Contract(stakingConfig.vsa, ERC20_ABI, signer ?? undefined).balanceOf(account) as Promise<bigint>)
          : Promise.resolve(0n),
      ]);
      setTvsBal(b);
      setVsaBal(v);
    } catch {
      /* 保留旧值 */
    }
  }, [account, ready, signer]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

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
    setTxHash("");
    try {
      const { hash } = await fn(signer);
      setTxHash(hash);
      toast("交易已广播…", "info");
      toast(okMsg, "ok");
      await Promise.all([refreshStats(), refreshMine(), loadBalances()]);
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
      setConfirmEmg(null);
    }
  };

  const doStake = () =>
    run(
      "stake",
      async (s) => {
        const amt = parseUnits(amount || "0", 18);
        if (amt <= 0n) throw new Error("请输入质押数量");
        const tvs = new Contract(stakingConfig.tvs, ERC20_ABI, s);
        const allowance = (await tvs.allowance(account, stakingConfig.staking)) as bigint;
        if (allowance < amt) {
          const ap = await tvs.approve(stakingConfig.staking, MaxUint256);
          await ap.wait();
        }
        const staking = new Contract(stakingConfig.staking, stakingAbi, s);
        const tx = await (staking.stake as (a: bigint, t: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(
          amt,
          termIdx,
        );
        await tx.wait();
        setAmount("");
        return { hash: tx.hash };
      },
      `质押成功 ✓（${TERMS[termIdx].label} / ${TERMS[termIdx].weightLabel}）`,
    );

  const doClaim = () =>
    run(
      "claim",
      async (s) => {
        const staking = new Contract(stakingConfig.staking, stakingAbi, s);
        const tx = await (staking.claim as () => Promise<{ hash: string; wait: () => Promise<unknown> }>)();
        await tx.wait();
        return { hash: tx.hash };
      },
      "领取成功 ✓（50% 已到账，50% 进入 90 天线性释放）",
    );

  const doReinvest = () =>
    run(
      "reinvest",
      async (s) => {
        const staking = new Contract(stakingConfig.staking, stakingAbi, s);
        const tx = await (
          staking.reinvest as (t: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>
        )(reinvestTerm);
        await tx.wait();
        return { hash: tx.hash };
      },
      `复投成功 ✓（额外 +10% VSA，${TERMS[reinvestTerm].label}）`,
    );

  const doUnstake = (id: number) =>
    run(
      "unstake",
      async (s) => {
        const staking = new Contract(stakingConfig.staking, stakingAbi, s);
        const tx = await (
          staking.unstake as (i: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>
        )(id);
        await tx.wait();
        return { hash: tx.hash };
      },
      "解押成功 ✓ 本金已退回",
    );

  const doEmergency = (id: number) =>
    run(
      "emergency",
      async (s) => {
        const staking = new Contract(stakingConfig.staking, stakingAbi, s);
        const tx = await (
          staking.emergencyUnstake as (i: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>
        )(id);
        await tx.wait();
        return { hash: tx.hash };
      },
      "已强行解除 ✓ 未释放奖励已没收",
    );

  const handleMax = () => setAmount(formatUnits(tvsBal, 18));

  const emissionBps = useMemo(() => {
    if (!stats) return 0;
    return Number((stats.emitted * 10000n) / stakingConfig.totalEmission);
  }, [stats]);

  const lockPct = useMemo(() => {
    if (!mine) return 0;
    const totalLock = mine.lockedTotal + mine.lockedReleased;
    if (totalLock === 0n) return 0;
    return Number((mine.lockedReleased * 10000n) / totalLock);
  }, [mine]);

  if (!ready) return <Placeholder />;

  const disabled = busy !== "" || !account;

  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
        <span className="kicker">ISSUE 05 · VSA Staking</span>
        <span className="serif" style={{ color: "var(--gray-d)", fontSize: 15 }}>质押 TVS · 产出 VSA</span>
      </div>
      <h1 style={{ marginBottom: 18 }}>
        质押 TVS <em className="em-gold">挖 VSA</em>
      </h1>
      <p className="serif" style={{ color: "var(--gray)", fontSize: 16, maxWidth: 720, marginBottom: 12 }}>
        10 年产出曲线，每 2 年衰减 30%，总量精确 <b style={{ color: "var(--gold-l)" }}>10,000,000 VSA</b>。
        个人产出 = 当日总产出 ×（个人加权量 ÷ 全网加权总量）；加权量 = 质押量 × 周期权重。
      </p>
      <p className="serif" style={{ color: "var(--gray-d)", fontSize: 14, maxWidth: 720, marginBottom: 36 }}>
        单地址加权质押 ≤ 全网 10%；结算窗口产出 ≤ 窗口总产出 20%。产出 50% 立即到账、50% 锁 90 天线性释放；
        不领取可复投并额外获得 10% VSA。
      </p>

      {/* ===== 全网数据 ===== */}
      <SectionTitle number="01" title="全网数据" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, margin: "18px 0 34px" }}>
        <Stat label="全网 TVS 质押" value={stats ? fmtNumber(stats.totalStakedTvs, 18, 2) : "—"} />
        <Stat
          label="复投 VSA 在押"
          value={stats ? fmtNumber(stats.totalStakedVsa, 18, 2) : "—"}
          sub="复投本金计入权重"
        />
        <Stat label="当前日产出" value={stats ? fmtNumber(stats.dailyEmission, 18, 2) : "—"} sub={stats ? `第 ${stats.dayIndex} / 3650 天` : undefined} />
        <Stat label="产出池余额" value={stats ? fmtNumber(stats.rewardPool, 18, 2) : "—"} sub="记账式额度" />
        <Stat label="复投奖池" value={stats ? fmtNumber(stats.bonusPool, 18, 2) : "—"} sub="多签注资" />
        <Stat label="池盈余" value={stats ? fmtNumber(stats.poolSurplus, 18, 2) : "—"} sub="可支配" />
      </div>

      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="kicker">10 年产出进度</span>
          <span className="mono" style={{ fontSize: 13, color: "var(--gold-l)" }}>
            {stats ? fmtNumber(stats.emitted, 18, 0) : "—"} / {fmtNumber(stakingConfig.totalEmission, 18, 0)} VSA
          </span>
        </div>
        <ProgressBar value={emissionBps} />
      </div>

      {/* ===== 质押 ===== */}
      <SectionTitle number="02" title="发起质押" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, margin: "18px 0" }}>
        {TERMS.map((t) => {
          const on = t.idx === termIdx;
          return (
            <button
              key={t.idx}
              type="button"
              onClick={() => setTermIdx(t.idx)}
              className="btn"
              style={{
                display: "block",
                textAlign: "left",
                padding: "14px 16px",
                borderColor: on ? "var(--gold)" : "var(--line)",
                background: on ? "rgba(212,175,55,0.08)" : "var(--card)",
              }}
            >
              <div className="mono" style={{ fontSize: 18, color: on ? "var(--gold-l)" : "var(--white)" }}>{t.label}</div>
              <div className="serif" style={{ fontSize: 12, color: "var(--gray-d)", marginTop: 4 }}>
                权重 {t.weightLabel} · 期内不可解押
              </div>
            </button>
          );
        })}
      </div>

      <div className="field" style={{ maxWidth: 520 }}>
        <label>质押数量（TVS）</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <button className="btn btn-sm" type="button" onClick={handleMax}>MAX</button>
        </div>
        <div className="input-hint">
          余额 {fmtNumber(tvsBal, 18, 4)} TVS · {" "}
          {account ? <AddressChip address={account} /> : "未连接钱包"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <button className="btn btn-gold" disabled={disabled} onClick={() => void doStake()}>
          {busy === "stake" ? "处理中…" : !account ? "连接钱包后质押" : "授权并质押"}
        </button>
        {txHash && (
          <a className="btn btn-ghost" href={`${EXPLORER_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer">
            查看交易 ↗
          </a>
        )}
      </div>

      {/* ===== 我的持仓 ===== */}
      <div style={{ marginTop: 44 }}>
        <SectionTitle number="03" title="我的质押" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, margin: "18px 0" }}>
          <Stat label="我的加权量" value={fmtNumber(mine.weighted, 18, 2)} />
          <Stat label="待领产出" value={fmtNumber(mine.pendingRaw, 18, 4)} sub="含本窗口结算" />
          <Stat label="可立即领取" value={fmtNumber(mine.claimableNow, 18, 4)} sub="50% 立即 + 已释放" />
          <Stat label="锁定中" value={fmtNumber(mine.lockedTotal, 18, 4)} sub="90 天线性释放" />
          {mine.deferred > 0n && (
            <Stat label="超限暂存" value={fmtNumber(mine.deferred, 18, 4)} sub="份额回落后自动补发" />
          )}
          <Stat label="VSA 余额" value={fmtNumber(vsaBal, 18, 4)} />
        </div>

        {/* 锁仓释放进度 */}
        {(mine.lockedTotal > 0n || mine.lockedReleased > 0n) && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span className="kicker">锁仓释放进度 · {mine.lockEntries} 笔在锁</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--gold-l)" }}>
                {fmtNumber(mine.lockedReleased, 18, 4)} 已释放 / 剩余 {fmtNumber(mine.lockedTotal, 18, 4)}
              </span>
            </div>
            <ProgressBar value={lockPct} />
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginBottom: 26, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-gold" disabled={disabled || mine.claimableNow === 0n} onClick={() => void doClaim()}>
            {busy === "claim" ? "处理中…" : "领取产出"}
          </button>
          <select
            className="input"
            style={{ maxWidth: 140 }}
            value={reinvestTerm}
            onChange={(e) => setReinvestTerm(Number(e.target.value))}
          >
            {TERMS.map((t) => (
              <option key={t.idx} value={t.idx}>{t.label} · {t.weightLabel}</option>
            ))}
          </select>
          <button className="btn btn-green" disabled={disabled || mine.claimableNow === 0n} onClick={() => void doReinvest()}>
            {busy === "reinvest" ? "处理中…" : "复投 +10%"}
          </button>
        </div>

        {mine.stakes.length === 0 ? (
          <p className="serif" style={{ color: "var(--gray-d)", fontSize: 14 }}>暂无质押记录。</p>
        ) : (
          <div>
            {[...mine.stakes].reverse().map((s) => (
              <StakeRow key={s.id} s={s} now={now} busy={busy} onUnstake={(id) => void doUnstake(id)} onEmergency={setConfirmEmg} />
            ))}
          </div>
        )}
      </div>

      {/* 强行解除二次确认 */}
      {confirmEmg !== null && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24,
          }}
        >
          <div style={{ maxWidth: 420, width: "100%", background: "var(--bg2)", border: "1px solid var(--red)", borderRadius: 12, padding: 24 }}>
            <h4 style={{ color: "var(--red)", marginBottom: 10 }}>确认强行解除？</h4>
            <p className="serif" style={{ fontSize: 14, color: "var(--gray)", lineHeight: 1.8, marginBottom: 18 }}>
              将退回本金，但该笔质押对应的<b style={{ color: "var(--red)" }}>全部未领取 + 锁定中奖励将被没收</b>（回收进产出池）。
              此操作不可撤销。若仅想退出，请等待到期后使用「解押本金」。
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn btn-sm" onClick={() => setConfirmEmg(null)}>取消</button>
              <button
                className="btn btn-sm"
                style={{ background: "var(--red)", color: "#fff" }}
                disabled={busy !== ""}
                onClick={() => confirmEmg !== null && void doEmergency(confirmEmg)}
              >
                {busy === "emergency" ? "处理中…" : "确认没收并解除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
