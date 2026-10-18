import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, Interface, MaxUint256, parseUnits, isAddress, getAddress } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import { SectionTitle, AddressChip } from "../components/ui";
import { EXPLORER_BASE, config, stakingConfig } from "../config";
import { stakingAbi, publicProvider } from "../lib/chain";
import { ERC20_ABI } from "../lib/swap";
import { fmtNumber } from "../lib/format";

/**
 * 管理台：金库注资 + 质押合约治理（主网 owner = 多签，故提供 Safe 交易 JSON 生成）
 * 仅供项目方使用，未挂到导航；直连 /admin 访问。所有写操作仍由链上 onlyOwner 把关。
 */

const VSA_ABI = [...ERC20_ABI, "function transfer(address,uint256) returns (bool)"];
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: "16px 18px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)" }}>
      <div className="kicker" style={{ fontSize: 11 }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, color: "var(--gold-l)", marginTop: 8, wordBreak: "break-all" }}>{value}</div>
      {sub && <div className="serif" style={{ fontSize: 12, color: "var(--gray-d)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "18px 20px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)" }}>
      <div className="kicker" style={{ fontSize: 11 }}>{title}</div>
      {hint && <p className="serif" style={{ fontSize: 12.5, color: "var(--gray-d)", marginTop: 6, lineHeight: 1.7 }}>{hint}</p>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

export default function Admin() {
  const { account, signer, chainId, connect } = useWallet();
  const toast = useToast();

  const [st, setSt] = useState<ChainState>(EMPTY_STATE);
  const [ownerInput, setOwnerInput] = useState("");
  const [rewardAmt, setRewardAmt] = useState("");
  const [bonusAmt, setBonusAmt] = useState("");
  const [txSender, setTxSender] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmt, setTransferAmt] = useState("");
  const [genJson, setGenJson] = useState("");
  const [genSender, setGenSender] = useState("");
  const [busy, setBusy] = useState("");
  const [txHash, setTxHash] = useState("");

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
      const acct = account && isAddress(account) ? getAddress(account) : "";
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
  const isPendingOwner = !!account && !!st.pendingOwner && account.toLowerCase() === st.pendingOwner.toLowerCase();

  const run = async (key: string, fn: (s: JsonRpcSigner) => Promise<{ hash: string }>, okMsg: string) => {
    if (!account || !signer) {
      await connect();
      return;
    }
    if (chainId !== config.chainId) {
      toast(`请切换到 ${config.chainId === 97 ? "BSC 测试网" : "BSC 主网"}（Chain ${config.chainId}）`, "err");
      return;
    }
    setBusy(key);
    setTxHash("");
    try {
      const { hash } = await fn(signer);
      setTxHash(hash);
      toast("交易已广播…", "info");
      toast(okMsg, "ok");
      await load();
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

  const parse = (v: string): bigint | null => {
    try {
      const n = parseUnits(v || "0", DECIMALS);
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  };

  const doApprove = (amount: bigint) =>
    run(
      "approve",
      async (s) => {
        const vsa = new Contract(vsaAddr, VSA_ABI, s);
        const tx = await (vsa.approve as (a: string, b: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(stakingAddr, amount);
        await tx.wait();
        return { hash: tx.hash };
      },
      "授权成功 ✓",
    );

  const doFund = (fn: "fundRewardPool" | "fundBonusPool", amount: bigint, label: string) =>
    run(
      fn,
      async (s) => {
        const c = new Contract(stakingAddr, stakingAbi, s);
        const tx = await (c[fn] as (a: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(amount);
        await tx.wait();
        return { hash: tx.hash };
      },
      `${label}注资成功 ✓`,
    );

  const doTransferVsa = (to: string, amount: bigint) =>
    run(
      "transfer",
      async (s) => {
        const vsa = new Contract(vsaAddr, VSA_ABI, s);
        const tx = await (vsa.transfer as (a: string, b: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(to, amount);
        await tx.wait();
        return { hash: tx.hash };
      },
      "VSA 转账成功 ✓",
    );

  const doTransferOwnership = (to: string) =>
    run(
      "transferOwnership",
      async (s) => {
        const c = new Contract(stakingAddr, stakingAbi, s);
        const tx = await (c.transferOwnership as (a: string) => Promise<{ hash: string; wait: () => Promise<unknown> }>)(to);
        await tx.wait();
        return { hash: tx.hash };
      },
      "所有权移交已发起 ✓（待对方 acceptOwnership 生效）",
    );

  const doAcceptOwnership = () =>
    run(
      "acceptOwnership",
      async (s) => {
        const c = new Contract(stakingAddr, stakingAbi, s);
        const tx = await (c.acceptOwnership as () => Promise<{ hash: string; wait: () => Promise<unknown> }>)();
        await tx.wait();
        return { hash: tx.hash };
      },
      "所有权已接收 ✓",
    );

  const safeJson = useMemo(() => {
    if (!genJson) return null;
    try {
      return JSON.parse(genJson) as unknown;
    } catch {
      return null;
    }
  }, [genJson]);

  const buildSafeJson = () => {
    const r = parse(rewardAmt);
    const b = parse(bonusAmt);
    const sender = txSender.trim();
    if (!r && !b) {
      toast("请填写产出池 / 复投池注资数量", "err");
      return;
    }
    const vsa = new Interface(VSA_ABI);
    const stk = new Interface(stakingAbi as never[]);
    const approveAmt = (r ?? 0n) + (b ?? 0n);
    const txs: { to: string; value: string; data: string }[] = [
      {
        to: vsaAddr,
        value: "0",
        data: vsa.encodeFunctionData("approve", [stakingAddr, approveAmt]),
      },
    ];
    if (r) txs.push({ to: stakingAddr, value: "0", data: stk.encodeFunctionData("fundRewardPool", [r]) });
    if (b) txs.push({ to: stakingAddr, value: "0", data: stk.encodeFunctionData("fundBonusPool", [b]) });
    setGenJson(JSON.stringify(txs, null, 2));
    setGenSender(sender);
    toast("Safe 交易 JSON 已生成", "ok");
  };

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast(`${label} 已复制`, "ok"),
      () => toast("复制失败，请手动选择", "err"),
    );
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
  const rewardAmtWei = parse(rewardAmt);
  const bonusAmtWei = parse(bonusAmt);
  const canFund = isOwner;

  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <span className="kicker">ADMIN · Treasury & Staking Ops</span>
        <span className="serif" style={{ color: "var(--gray-d)", fontSize: 15 }}>{netLabel}</span>
      </div>
      <h1 style={{ marginBottom: 18 }}>金库注资 <em className="em-gold">与质押治理</em></h1>
      <p className="serif" style={{ color: "var(--gray-d)", fontSize: 14, maxWidth: 780, marginBottom: 30, lineHeight: 1.9 }}>
        本页仅做「交易构造 + 广播」，所有权限由链上 <span className="mono">onlyOwner</span> 把关。
        owner 是多签时，直接执行按钮会失效，请改用第五节的 <b style={{ color: "var(--gold-l)" }}>Safe 交易 JSON</b> 粘贴到 Safe Transaction Builder 发起。
      </p>

      {!account && (
        <div className="banner" style={{ marginBottom: 28 }}>
          <span className="banner-mark">†</span>
          <div>
            <h4>未连接钱包</h4>
            <p>连接后即可看到你的 VSA 余额、授权额度与角色判定。<button className="btn btn-sm btn-gold" style={{ marginLeft: 12 }} onClick={() => void connect()}>连接钱包</button></p>
          </div>
        </div>
      )}

      {/* 01 链上状态 */}
      <SectionTitle number="01" title="链上状态" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, margin: "18px 0 30px" }}>
        <Stat label="产出池余额 rewardPool" value={fmtNumber(st.rewardPool, 18, 2)} sub="可派发额度（10 年共需 1000 万 VSA）" />
        <Stat label="复投奖池 bonusPool" value={fmtNumber(st.bonusPool, 18, 2)} sub="复投 +10% 奖励额度" />
        <Stat label="池盈余" value={fmtNumber(st.poolSurplus, 18, 2)} sub="可支配（不属于任何账本）" />
        <Stat label="全网 TVS 在押" value={fmtNumber(st.totalStakedTvs, 18, 2)} sub="质押者本金（owner 不可动）" />
        <Stat label="owner 持 VSA" value={fmtNumber(st.ownerVsa, 18, 2)} sub="注资前 owner 必须持有 VSA" />
        <Stat
          label="我的 VSA / 授权额"
          value={`${fmtNumber(st.acctVsa, 18, 2)} / ${st.allowance > 10n ** 30n ? "无限" : fmtNumber(st.allowance, 18, 2)}`}
          sub="我的余额 / 我对质押合约的授权"
        />
      </div>

      {/* 02 地址与角色 */}
      <SectionTitle number="02" title="地址与角色" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, margin: "18px 0 30px" }}>
        <Stat
          label={`owner${isOwner ? " · 当前钱包 ✓" : ""}`}
          value={st.owner ? `${st.owner.slice(0, 10)}…${st.owner.slice(-6)}` : "—"}
          sub="唯一有权注资与移交所有权"
        />
        <Stat
          label={`pendingOwner${isPendingOwner ? " · 当前钱包 ✓" : ""}`}
          value={
            !st.pendingOwner || st.pendingOwner === ZERO_ADDR
              ? "未设置"
              : `${st.pendingOwner.slice(0, 10)}…${st.pendingOwner.slice(-6)}`
          }
          sub="待该地址执行 acceptOwnership 完成交接"
        />
        <Stat label="质押合约" value={`${stakingAddr.slice(0, 10)}…${stakingAddr.slice(-6)}`} />
        <Stat label="VSA 代币" value={`${vsaAddr.slice(0, 10)}…${vsaAddr.slice(-6)}`} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 34 }}>
        <a className="btn btn-ghost btn-sm" href={`${EXPLORER_BASE}/address/${stakingAddr}`} target="_blank" rel="noreferrer">质押合约 ↗</a>
        <a className="btn btn-ghost btn-sm" href={`${EXPLORER_BASE}/address/${vsaAddr}`} target="_blank" rel="noreferrer">VSA 代币 ↗</a>
        {account && <AddressChip address={account} suffix="（当前钱包）" />}
        {txHash && <a className="btn btn-ghost btn-sm" href={`${EXPLORER_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer">最近交易 ↗</a>}
      </div>

      {/* 03 直接执行（EOA owner） */}
      <SectionTitle
        number="03"
        title="直接执行（owner = 单签钱包时）"
        intro="金额按 VSA 枚数填写。顺序必须是「先授权、后注资」。owner 若是多签，本节按钮会被禁用，请用第五节。"
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, margin: "20px 0 34px" }}>
        <Card title="① 注资产出池" hint="产出池是 10 年挖矿产出的唯一资金来源；未注资时用户可质押但领不到产出。">
          <input className="input" placeholder="数量（VSA）" value={rewardAmt} onChange={(e) => setRewardAmt(e.target.value)} />
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              className="btn btn-sm btn-gold"
              disabled={!canFund || busy !== "" || !isOwner}
              onClick={() => {
                const a = parse(rewardAmt);
                if (!a) return toast("请输入有效数量", "err");
                void doFund("fundRewardPool", a, "产出池");
              }}
            >
              {busy === "fundRewardPool" ? "处理中…" : "直接注资"}
            </button>
            <button
              className="btn btn-sm"
              disabled={busy !== "" || !account}
              onClick={() => {
                const a = parse(rewardAmt);
                if (!a) return toast("请输入有效数量", "err");
                void doApprove(a);
              }}
            >
              {busy === "approve" ? "处理中…" : "仅授权该数量"}
            </button>
          </div>
        </Card>

        <Card title="② 注资复投奖池" hint="复投额外 +10% 奖励由此池支付；不注资则复投会因额度不足失败。">
          <input className="input" placeholder="数量（VSA）" value={bonusAmt} onChange={(e) => setBonusAmt(e.target.value)} />
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              className="btn btn-sm btn-gold"
              disabled={!canFund || busy !== "" || !isOwner}
              onClick={() => {
                const a = parse(bonusAmt);
                if (!a) return toast("请输入有效数量", "err");
                void doFund("fundBonusPool", a, "复投奖池");
              }}
            >
              {busy === "fundBonusPool" ? "处理中…" : "直接注资"}
            </button>
            <button
              className="btn btn-sm"
              disabled={busy !== "" || !account}
              onClick={() => void doApprove(MaxUint256)}
            >
              {busy === "approve" ? "处理中…" : "授权无限额度"}
            </button>
          </div>
        </Card>

        <Card title="③ VSA 转账" hint="若 owner 不持有 VSA（例如 owner 是质押多签、而 VSA 在金库多签），先把 VSA 转到 owner 地址再注资。">
          <input
            className="input"
            placeholder="收款地址（可一键填 owner）"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {st.owner && (
            <button className="btn btn-sm btn-ghost" disabled={busy !== ""} onClick={() => setTransferTo(st.owner)}>
              填入 owner 地址
            </button>
          )}
          <input className="input" placeholder="数量（VSA）" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} style={{ marginTop: 10 }} />
          <button
            className="btn btn-sm"
            style={{ marginTop: 12 }}
            disabled={busy !== "" || !account}
            onClick={() => {
              const a = parse(transferAmt);
              if (!a) return toast("请输入有效数量", "err");
              if (!isAddress(transferTo)) return toast("收款地址不合法", "err");
              void doTransferVsa(getAddress(transferTo), a);
            }}
          >
            {busy === "transfer" ? "处理中…" : "转账 VSA"}
          </button>
        </Card>
      </div>

      {/* 04 所有权交接 */}
      <SectionTitle
        number="04"
        title="所有权交接（Ownable2Step）"
        intro="两步确认：当前 owner 调 transferOwnership 指定新 owner，新 owner 再调 acceptOwnership 才真正生效。交接后原部署私钥立即失去全部合约权限。"
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, margin: "20px 0 34px" }}>
        <Card title="指定新 owner" hint="交接完成后，注资等 owner 权限全部转移到该地址。">
          <input className="input" placeholder="新 owner 地址" value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} />
          <button
            className="btn btn-sm btn-gold"
            style={{ marginTop: 12 }}
            disabled={busy !== "" || !isOwner}
            onClick={() => {
              if (!isAddress(ownerInput)) return toast("地址不合法", "err");
              void doTransferOwnership(getAddress(ownerInput));
            }}
          >
            {busy === "transferOwnership" ? "处理中…" : "发起所有权移交"}
          </button>
        </Card>
        <Card title="接收所有权" hint="仅 pendingOwner 本人可执行。执行后本钱包成为新 owner。">
          <button className="btn btn-sm btn-gold" disabled={busy !== "" || !isPendingOwner} onClick={() => void doAcceptOwnership()}>
            {busy === "acceptOwnership" ? "处理中…" : "acceptOwnership()"}
          </button>
          {!isPendingOwner && st.pendingOwner && st.pendingOwner !== ZERO_ADDR && (
            <p className="serif" style={{ fontSize: 12, color: "var(--gray-d)", marginTop: 10 }}>
              当前钱包不是 pendingOwner，需由 <span className="mono">{st.pendingOwner.slice(0, 10)}…</span> 执行。
            </p>
          )}
        </Card>
      </div>

      {/* 05 Safe 交易生成 */}
      <SectionTitle
        number="05"
        title="Safe 交易 JSON（owner = 多签时用）"
        intro="填好数量点生成，把 JSON 数组整段粘贴进 Safe 的 Transaction Builder（New transaction → Custom / Transaction Builder → 粘贴 JSON）。三笔一次签名：先授权、再注入产出池、再注入复投奖池。"
      />
      <div style={{ margin: "20px 0 34px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <Card title="产出池数量（可留空）">
            <input className="input" placeholder="VSA 数量" value={rewardAmt} onChange={(e) => setRewardAmt(e.target.value)} />
          </Card>
          <Card title="复投奖池数量（可留空）">
            <input className="input" placeholder="VSA 数量" value={bonusAmt} onChange={(e) => setBonusAmt(e.target.value)} />
          </Card>
          <Card title="发起钱包（备注用）">
            <input className="input" placeholder="多签地址（可选）" value={txSender} onChange={(e) => setTxSender(e.target.value)} />
          </Card>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-gold" onClick={buildSafeJson}>生成 Safe 交易 JSON</button>
          {safeJson !== null && (
            <button className="btn" onClick={() => copy(genJson, "JSON")}>复制 JSON</button>
          )}
        </div>
        {genJson && (
          <div style={{ marginTop: 16 }}>
            <div className="kicker" style={{ fontSize: 11, marginBottom: 8 }}>
              授权 {rewardAmtWei && bonusAmtWei ? fmtNumber(rewardAmtWei + bonusAmtWei, 18, 2) : rewardAmtWei ? fmtNumber(rewardAmtWei, 18, 2) : bonusAmtWei ? fmtNumber(bonusAmtWei, 18, 2) : "0"} VSA
              {genSender ? ` · 发起方 ${genSender.slice(0, 8)}…${genSender.slice(-4)}` : ""}
            </div>
            <textarea
              readOnly
              value={genJson}
              spellCheck={false}
              style={{
                width: "100%", minHeight: 240, padding: 14, borderRadius: 10, border: "1px solid var(--line)",
                background: "var(--bg2, #0d0d0d)", color: "var(--gray)", fontFamily: "monospace", fontSize: 12, lineHeight: 1.7,
              }}
            />
          </div>
        )}
      </div>

      <div className="banner" style={{ marginBottom: 40 }}>
        <span className="banner-mark">‡</span>
        <div>
          <h4>操作须知</h4>
          <p>
            ① 注资必须由 <b>owner</b> 发起（合约 <span className="mono">onlyOwner</span>）；若 VSA 在别的钱包，先转到 owner 地址。
            ② 授权对象必须是质押合约本身，且授权额 ≥ 注资额。
            ③ 产出池 10 年总产出 10,000,000 VSA，可分批注入，随时补。
            ④ 质押者本金为 TVS，owner 只能回收「合约余额 − 在押本金」的盈余，<b>动不了质押本金</b>；VSA 永久禁止回收。
          </p>
        </div>
      </div>
    </section>
  );
}
