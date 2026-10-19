import { useCallback, useEffect, useState } from "react";
import { Contract, parseUnits } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import { SectionTitle } from "../components/ui";
import { config, stakingConfig } from "../config";
import { stakingAbi, publicProvider } from "../lib/chain";
import { ERC20_ABI } from "../lib/swap";
import { fmtNumber } from "../lib/format";

/**
 * 管理台（简版）：只读链上状态 + 一键注资
 * 未挂导航，直连 /admin 访问。owner 是多签时按钮不可用，请到 Safe 执行。
 */

const VSA_ABI = ERC20_ABI;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const DECIMALS = 18;

interface ChainState {
  owner: string;
  pendingOwner: string;
  rewardPool: bigint;
  bonusPool: bigint;
  poolSurplus: bigint;
  totalStakedTvs: bigint;
  ownerVsa: bigint;
  acctVsa: bigint;
  allowance: bigint;
}

const EMPTY_STATE: ChainState = {
  owner: "",
  pendingOwner: "",
  rewardPool: 0n,
  bonusPool: 0n,
  poolSurplus: 0n,
  totalStakedTvs: 0n,
  ownerVsa: 0n,
  acctVsa: 0n,
  allowance: 0n,
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "16px 18px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)" }}>
      <div className="kicker" style={{ fontSize: 11 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, color: "var(--gold-l)", marginTop: 8, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

export default function Admin() {
  const { account, signer, chainId, connect } = useWallet();
  const toast = useToast();

  const [st, setSt] = useState<ChainState>(EMPTY_STATE);
  const [rewardAmt, setRewardAmt] = useState("");
  const [bonusAmt, setBonusAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const stakingAddr = stakingConfig.staking;
  const vsaAddr = stakingConfig.vsa;
  const ready = stakingConfig.stakingReady && !!stakingAddr && !!vsaAddr;

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const c = new Contract(stakingAddr, stakingAbi, publicProvider);
      const vsa = new Contract(vsaAddr, VSA_ABI, publicProvider);
      const [owner, pendingOwner, rewardPool, bonusPool, surplus, staked] = await Promise.all([
        c.owner() as Promise<string>,
        c.pendingOwner() as Promise<string>,
        c.rewardPool() as Promise<bigint>,
        c.bonusPool() as Promise<bigint>,
        c.poolSurplus() as Promise<bigint>,
        c.totalStakedTvs() as Promise<bigint>,
      ]);
      const ownerVsa = (await vsa.balanceOf(owner)) as bigint;
      const acct = account ?? "";
      const acctVsa = acct ? ((await vsa.balanceOf(acct)) as bigint) : 0n;
      const allowance = acct ? ((await vsa.allowance(acct, stakingAddr)) as bigint) : 0n;
      setSt({ owner, pendingOwner, rewardPool, bonusPool, poolSurplus: surplus, totalStakedTvs: staked, ownerVsa, acctVsa, allowance });
    } catch {
      /* 保留旧值 */
    }
  }, [ready, stakingAddr, vsaAddr, account]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = !!account && !!st.owner && account.toLowerCase() === st.owner.toLowerCase();
  const ownerIsMulti = !!st.owner && st.pendingOwner !== ZERO_ADDR;

  const parse = (v: string): bigint | null => {
    try {
      const n = parseUnits(v || "0", DECIMALS);
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  };

  /** 一键注资：先按需 approve，再逐池 fund（全程一个按钮） */
  const doFund = async () => {
    const r = parse(rewardAmt);
    const b = parse(bonusAmt);
    if (!r && !b) {
      toast("请填写产出池或复投奖池数量", "err");
      return;
    }
    if (!account || !signer) {
      await connect();
      return;
    }
    if (chainId !== config.chainId) {
      toast(`请切换到 ${config.chainId === 97 ? "BSC 测试网" : "BSC 主网"}（Chain ${config.chainId}）`, "err");
      return;
    }
    if (!isOwner) {
      toast("当前钱包不是 owner —— owner 是多签，请到 Safe 执行", "err");
      return;
    }
    const need = (r ?? 0n) + (b ?? 0n);
    if (st.acctVsa < need) {
      toast(`VSA 余额不足：当前钱包 ${fmtNumber(st.acctVsa, 18, 2)}，本次需 ${fmtNumber(need, 18, 2)}。请先把 VSA 转入该地址再操作`, "err");
      return;
    }
    setBusy(true);
    try {
      const vsa = new Contract(vsaAddr, VSA_ABI, signer);
      const approveFn = vsa.approve as (a: string, b: bigint) => Promise<{ wait: () => Promise<unknown> }>;
      const cur = (await vsa.allowance(account, stakingAddr)) as bigint;
      if (cur < need) {
        toast("① 授权 VSA 中…", "info");
        await (await approveFn(stakingAddr, need)).wait();
      }
      const c = new Contract(stakingAddr, stakingAbi, signer);
      if (r) {
        toast("② 注入产出池…", "info");
        const fn = c.fundRewardPool as (a: bigint) => Promise<{ wait: () => Promise<unknown> }>;
        await (await fn(r)).wait();
      }
      if (b) {
        toast("③ 注入复投奖池…", "info");
        const fn = c.fundBonusPool as (a: bigint) => Promise<{ wait: () => Promise<unknown> }>;
        await (await fn(b)).wait();
      }
      toast("注资完成 ✓", "ok");
      setRewardAmt("");
      setBonusAmt("");
      await load();
    } catch (e) {
      const msg =
        (e as { shortMessage?: string }).shortMessage ||
        (e as Error).message ||
        "";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(`失败: ${String(msg).slice(0, 140)}`, "err");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <section className="container page" style={{ paddingTop: 48 }}>
        <div className="rule-bold" style={{ marginBottom: 28 }} />
        <span className="kicker">ADMIN · Treasury</span>
        <h1 style={{ marginTop: 12 }}>管理台 <em className="em-gold">未启用</em></h1>
        <div className="banner" style={{ marginTop: 28 }}>
          <span className="banner-mark">‡</span>
          <div>
            <h4>合约未就绪</h4>
            <p>当前网络的质押合约或 VSA 代币地址未配置，管理台不可用。</p>
          </div>
        </div>
      </section>
    );
  }

  const netLabel = config.chainId === 97 ? "BSC Testnet (97)" : "BSC Mainnet (56)";
  const need = (parse(rewardAmt) ?? 0n) + (parse(bonusAmt) ?? 0n);

  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <span className="kicker">ADMIN · Treasury</span>
        <span className="serif" style={{ color: "var(--gray-d)", fontSize: 15 }}>{netLabel}</span>
      </div>
      <h1 style={{ marginBottom: 18 }}>金库 <em className="em-gold">注资</em></h1>

      {!account && (
        <div className="banner" style={{ marginBottom: 24 }}>
          <span className="banner-mark">†</span>
          <div>
            <h4>未连接钱包</h4>
            <p>连接后即可看到你的 VSA 余额与授权额度。<button className="btn btn-sm btn-gold" style={{ marginLeft: 12 }} onClick={() => void connect()}>连接钱包</button></p>
          </div>
        </div>
      )}

      {/* 01 链上状态 */}
      <SectionTitle number="01" title="链上状态" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, margin: "18px 0 30px" }}>
        <Stat label="产出池余额 rewardPool" value={fmtNumber(st.rewardPool, 18, 2)} />
        <Stat label="复投奖池 bonusPool" value={fmtNumber(st.bonusPool, 18, 2)} />
        <Stat label="池盈余" value={fmtNumber(st.poolSurplus, 18, 2)} />
        <Stat label="全网 TVS 在押" value={fmtNumber(st.totalStakedTvs, 18, 2)} />
        <Stat
          label={`owner${isOwner ? " · 当前钱包 ✓" : ""}`}
          value={st.owner ? `${st.owner.slice(0, 10)}…${st.owner.slice(-6)}` : "—"}
        />
        <Stat label="owner 持 VSA" value={fmtNumber(st.ownerVsa, 18, 2)} />
        <Stat
          label="我的 VSA / 授权额"
          value={`${fmtNumber(st.acctVsa, 18, 2)} / ${st.allowance > 10n ** 30n ? "无限" : fmtNumber(st.allowance, 18, 2)}`}
        />
      </div>

      {/* 02 一键注资 */}
      <SectionTitle
        number="02"
        title="一键注资"
        intro="金额按 VSA 枚数填写，可只填一个池。点一次按钮自动完成「授权 + 注资」。仅当当前连接钱包 = owner 时可执行；owner 是多签时，请在 Safe App 内打开本页并连接多签后操作。"
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, margin: "18px 0 18px" }}>
        <div>
          <div className="kicker" style={{ fontSize: 11, marginBottom: 8 }}>产出池数量</div>
          <input className="input" placeholder="VSA 数量（可留空）" value={rewardAmt} onChange={(e) => setRewardAmt(e.target.value)} />
        </div>
        <div>
          <div className="kicker" style={{ fontSize: 11, marginBottom: 8 }}>复投奖池数量</div>
          <input className="input" placeholder="VSA 数量（可留空）" value={bonusAmt} onChange={(e) => setBonusAmt(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 34 }}>
        <button className="btn btn-gold" disabled={busy || !isOwner} onClick={() => void doFund()}>
          {busy ? "处理中…" : `一键注资${need > 0n ? `（授权 ${fmtNumber(need, 18, 2)} VSA）` : ""}`}
        </button>
        {account && !isOwner && (
          <span className="serif" style={{ fontSize: 12.5, color: "var(--gray-d)" }}>
            当前钱包不是 owner，按钮不可用{ownerIsMulti ? "（owner 已交由多签，请用 Safe 发起）" : ""}。
          </span>
        )}
        {account && isOwner && st.acctVsa === 0n && (
          <span className="serif" style={{ fontSize: 12.5, color: "var(--gold-l)" }}>
            当前钱包 VSA 余额为 0 —— 请先把 VSA 转入该地址，再点注资。
          </span>
        )}
      </div>

      <div className="banner" style={{ marginBottom: 40 }}>
        <span className="banner-mark">‡</span>
        <div>
          <h4>须知</h4>
          <p>
            ① 注资必须由 <b>owner</b> 发起（合约 <span className="mono">onlyOwner</span>）；若 VSA 不在 owner 手里，先转到 owner 再操作。
            ② 产出池是 10 年挖矿产出的唯一资金来源，产出池为 0 时用户可质押但领不到产出。
            ③ 质押者本金是 TVS，owner 只能回收「合约余额 − 在押本金」的盈余，动不了本金；VSA 永久禁止回收。
          </p>
        </div>
      </div>
    </section>
  );
}
