import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers, Contract } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import {
  readTendril, readTvs, readPair, readRouter, pathFor, applySlippage, deadline20m,
  ERC20_ABI, PAIR_ABI, ROUTER_ABI, FEE_SWAP_ABI, feeAmount, TVS_STATES,
} from "../lib/swap";
import { swapConfig, config, EXPLORER_BASE } from "../config";

type Tab = "buy" | "sell" | "liqadd" | "liqremove";

interface PoolInfo {
  resT: bigint;
  resV: bigint;
  price: number;
  stateNum: number;
  buyTaxPct: number;
  sellTaxPct: number;
  registered: boolean;
}

const SLIPS = [0.1, 0.5, 1, 3];

const emptyPool: PoolInfo = {
  resT: 0n, resV: 0n, price: 0, stateNum: 0, buyTaxPct: 0, sellTaxPct: 0, registered: false,
};

const fmt = (n: bigint | number | string | null | undefined, d = 4): string => {
  if (n === null || n === undefined) return "--";
  const v = typeof n === "bigint" ? Number(ethers.formatEther(n)) : Number(n);
  if (!Number.isFinite(v)) return "--";
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
};

const lbl = (v: bigint | null) => (v === null ? "余额: --" : `余额: ${fmt(v)}`);
const addrS = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-");

export default function Swap() {
  const { account, signer, connect, chainId } = useWallet();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("buy");
  const [slippage, setSlippage] = useState(0.1);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [ball, setBall] = useState<{ t: bigint | null; v: bigint | null; lp: bigint | null }>({ t: null, v: null, lp: null });
  const [inAmt, setInAmt] = useState("");
  const [outAmt, setOutAmt] = useState("");
  const [minOut, setMinOut] = useState("");
  const [rateLine, setRateLine] = useState("");
  const [liqT, setLiqT] = useState("");
  const [liqV, setLiqV] = useState("");
  const [liqHint, setLiqHint] = useState("");
  const [liqLp, setLiqLp] = useState("");
  const [lpHint, setLpHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [authHint, setAuthHint] = useState("");

  const buy = tab === "buy";
  const inToken = buy ? "TENDRIL" : "TVS";
  const outToken = buy ? "TVS" : "TENDRIL";

  const router = useMemo(() => readRouter(), []);
  const tendril = useMemo(() => readTendril(), []);
  const tvs = useMemo(() => readTvs(), []);
  const pair = useMemo(() => readPair(), []);

  const st = pool ? TVS_STATES[pool.stateNum] ?? `State ${pool.stateNum}` : "--";

  /* ===== 池子信息 / 税制 ===== */
  const loadPool = useCallback(async () => {
    try {
      const [r0, r1] = await pair.getReserves();
      const t0 = (await pair.token0()).toLowerCase();
      const isTvs0 = t0 === swapConfig.tvs.toLowerCase();
      const resT = (isTvs0 ? r1 : r0) as bigint;
      const resV = (isTvs0 ? r0 : r1) as bigint;
      const [sn, bt, stx, reg] = await Promise.all([
        tvs.state(),
        tvs.buyTaxRate(),
        tvs.sellTaxRate(),
        tvs.pools(swapConfig.pair),
      ]);
      setPool({
        resT, resV,
        price: resT > 0n ? Number(resV) / Number(resT) : 0,
        stateNum: Number(sn),
        buyTaxPct: Number(bt) / 100,
        sellTaxPct: Number(stx) / 100,
        registered: Boolean(reg),
      });
    } catch {
      /* RPC 未通 */
    }
  }, [pair, tvs]);

  /* ===== 余额 / LP ===== */
  const loadBalances = useCallback(async () => {
    if (!account) {
      setBall({ t: null, v: null, lp: null });
      return;
    }
    try {
      const [bT, bV, lp] = await Promise.all([
        tendril.balanceOf(account), tvs.balanceOf(account), pair.balanceOf(account),
      ]);
      setBall({ t: bT as bigint, v: bV as bigint, lp: lp as bigint });
    } catch {
      /* 忽略 */
    }
  }, [account, tendril, tvs, pair]);

  useEffect(() => {
    void loadPool();
    void loadBalances();
    const t = setInterval(() => void loadPool(), 15_000);
    return () => clearInterval(t);
  }, [loadPool, loadBalances]);

  useEffect(() => {
    void loadBalances();
  }, [account, loadBalances, txHash]);

  /* ===== 实时报价 ===== */
  const doQuote = useCallback(async () => {
    setOutAmt("");
    setMinOut("最低获得: --");
    setRateLine("--");
    if (!inAmt || Number(inAmt) <= 0 || (tab !== "buy" && tab !== "sell")) return;
    try {
      const amountIn = ethers.parseEther(String(inAmt));
      const swapIn = amountIn - feeAmount(amountIn); // 先扣 3% 平台费，余 97% 进池
      const amounts = await router.getAmountsOut(swapIn, pathFor(buy));
      const out = amounts[1] as bigint;
      const min = applySlippage(out, slippage);
      setOutAmt(fmt(out));
      setMinOut(`最低获得(含3%平台费): ${fmt(min)}`);
      setRateLine(
        buy
          ? `1 TENDRIL ≈ ${fmt(Number(out) / Number(amountIn), 6)} TVS · 含 3% 平台费`
          : `1 TVS ≈ ${fmt(Number(out) / Number(amountIn), 6)} TENDRIL · 含 3% 平台费`,
      );
    } catch (e) {
      setMinOut(`报价失败: ${(e as { shortMessage?: string }).shortMessage || (e as Error).message}`);
    }
  }, [inAmt, tab, buy, router, slippage]);

  useEffect(() => {
    const t = setTimeout(() => void doQuote(), 250);
    return () => clearTimeout(t);
  }, [doQuote]);

  /* ===== 加池比例建议 ===== */
  useEffect(() => {
    if (tab !== "liqadd" || !pool || pool.resT <= 0n || !liqT || Number(liqT) <= 0) {
      setLiqV("");
      setLiqHint("");
      return;
    }
    const tend = ethers.parseEther(String(liqT));
    const need = (tend * pool.resV) / pool.resT;
    setLiqV(fmt(need));
    setLiqHint(`按当前比例，建议同时投入 ${fmt(need)} TVS（可手动改，Router 会自动调仓）`);
  }, [liqT, tab, pool]);

  /* ===== 移除流动性预估 ===== */
  useEffect(() => {
    if (tab !== "liqremove") {
      setLpHint("");
      return;
    }
    if (!liqLp || Number(liqLp) <= 0 || !pool) {
      setLpHint("");
      return;
    }
    void (async () => {
      try {
        const total = (await pair.totalSupply()) as bigint;
        const lpAmt = ethers.parseEther(String(liqLp));
        if (total <= 0n) return;
        const t0 = (lpAmt * pool.resT) / total;
        const v0 = (lpAmt * pool.resV) / total;
        setLpHint(`预计赎回 ≈ ${fmt(t0)} TENDRIL + ${fmt(v0)} TVS`);
      } catch {
        /* 忽略 */
      }
    })();
  }, [liqLp, tab, pool, pair]);

  useEffect(() => {
    setOutAmt(""); setMinOut("最低获得: --"); setRateLine("--");
    setLiqT(""); setLiqV(""); setLiqHint(""); setLiqLp(""); setLpHint("");
  }, [tab]);

  const approve = async (token: Contract, need: bigint, spender: string = swapConfig.router) => {
    const allowance = (await token.allowance(account!, spender)) as bigint;
    if (allowance < need) {
      setAuthHint("授权中…");
      const tx = await token.approve(spender, ethers.MaxUint256);
      await tx.wait();
      setAuthHint("授权完成 ✓");
    }
  };

  const run = async (fn: () => Promise<{ hash: string }>, okMsg: string) => {
    setBusy(true);
    setTxHash("");
    try {
      const { hash } = await fn();
      setTxHash(hash);
      toast("交易已广播…", "info");
      toast(okMsg, "ok");
      setAuthHint("");
      await loadPool();
      await loadBalances();
    } catch (e) {
      const msg = ((e as { shortMessage?: string }).shortMessage || (e as Error).message || (e as { reason?: string }).reason) ?? "";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(`失败: ${String(msg).slice(0, 120)}`, "err");
    } finally {
      setBusy(false);
    }
  };

  const doSwap = () =>
    run(async () => {
      const amountIn = ethers.parseEther(String(inAmt));
      const swapIn = amountIn - feeAmount(amountIn); // 与报价一致：先扣 3% 平台费
      const amounts = await router.getAmountsOut(swapIn, pathFor(buy));
      const min = applySlippage(amounts[1] as bigint, slippage);
      const token = new Contract(buy ? swapConfig.tendril : swapConfig.tvs, ERC20_ABI, signer!) as unknown as Contract;
      await approve(token, amountIn, swapConfig.feeSwap); // 授权给 FeeSwap（平台费网关）
      const sFeeSwap = new Contract(swapConfig.feeSwap, FEE_SWAP_ABI, signer!) as unknown as {
        swapExactTokensForTokens: (a: bigint, b: bigint, p: string[], to: string, d: number) => Promise<{ hash: string; wait: () => Promise<void> }>;
      };
      const tx = await sFeeSwap.swapExactTokensForTokens(
        amountIn, min, pathFor(buy), account!, deadline20m(),
      );
      await tx.wait();
      return { hash: tx.hash };
    }, `${buy ? "买入" : "卖出"} TVS 成功 ✓（3% 平台费已收取）`);

  const doAddLiq = () =>
    run(async () => {
      const amountT = ethers.parseEther(String(liqT));
      const amountV = ethers.parseEther(String(liqV));
      const minT = applySlippage(amountT, slippage);
      const minV = applySlippage(amountV, slippage);
      const mk = (addr: string) => new Contract(addr, ERC20_ABI, signer!) as unknown as Contract;
      setAuthHint("授权 TENDRIL / TVS 中…");
      await approve(mk(swapConfig.tendril), amountT);
      await approve(mk(swapConfig.tvs), amountV);
      const sRouter = new Contract(swapConfig.router, ROUTER_ABI, signer!) as unknown as {
        addLiquidity: (a: string, b: string, amtA: bigint, amtB: bigint, minA: bigint, minB: bigint, to: string, d: number) => Promise<{ hash: string; wait: () => Promise<void> }>;
      };
      const tx = await sRouter.addLiquidity(
        swapConfig.tendril, swapConfig.tvs, amountT, amountV, minT, minV, account!, deadline20m(),
      );
      await tx.wait();
      return { hash: tx.hash };
    }, "加流动性成功，LP 已到账 ✓");

  const doRemoveLiq = () =>
    run(async () => {
      const lpAmt = ethers.parseEther(String(liqLp));
      const lpToken = new Contract(swapConfig.pair, [...ERC20_ABI, ...PAIR_ABI], signer!) as unknown as Contract;
      setAuthHint("授权 LP 中…");
      await approve(lpToken, lpAmt);
      const total = (await pair.totalSupply()) as bigint;
      const minT = applySlippage((lpAmt * pool!.resT) / total, slippage);
      const minV = applySlippage((lpAmt * pool!.resV) / total, slippage);
      const sRouter = new Contract(swapConfig.router, ROUTER_ABI, signer!) as unknown as {
        removeLiquidity: (a: string, b: string, lp: bigint, minA: bigint, minB: bigint, to: string, d: number) => Promise<{ hash: string; wait: () => Promise<void> }>;
      };
      const tx = await sRouter.removeLiquidity(
        swapConfig.tendril, swapConfig.tvs, lpAmt, minT, minV, account!, deadline20m(),
      );
      await tx.wait();
      return { hash: tx.hash };
    }, "移除流动性成功 ✓");

  const handleAction = async () => {
    if (!account || !signer) {
      await connect();
      return;
    }
    if (chainId !== config.chainId) {
      toast(`请切换到 ${config.nativeSymbol} 主网（Chain ${config.chainId}）`, "err");
      return;
    }
    if (tab === "buy" || tab === "sell") {
      if (!inAmt || Number(inAmt) <= 0) return toast("请输入数量", "err");
      await doSwap();
    } else if (tab === "liqadd") {
      if (!liqT || !liqV || Number(liqT) <= 0 || Number(liqV) <= 0) return toast("请输入 TENDRIL 和 TVS 数量", "err");
      await doAddLiq();
    } else {
      if (!liqLp || Number(liqLp) <= 0) return toast("请输入 LP 数量", "err");
      await doRemoveLiq();
    }
  };

  const handleMax = async () => {
    if (!account || (tab !== "buy" && tab !== "sell")) return;
    const b = buy ? await tendril.balanceOf(account) : await tvs.balanceOf(account);
    setInAmt(ethers.formatEther(b as bigint));
  };

  const actionLabel = !account ? "连接钱包后开始" : tab === "buy" ? "买入 TVS" : tab === "sell" ? "卖出 TVS" : tab === "liqadd" ? "添加流动性" : "移除流动性";
  const warn = pool?.registered
    ? { danger: true, text: `⚠ 直连池已被 TVS 登记进 pools：TVS 侧将叠加代币税（当前买 ${pool.buyTaxPct}% / 卖 ${pool.sellTaxPct}%），与平台 3% 通道费同时收取。` }
    : { danger: false, text: "直连池两端代币税均不触发（TENDRIL 30% 仅对 USDT 主池、TVS 3% 仅对登记池）。本平台另收取 3% 通道费进入平台钱包，与代币税无关。" };

  return (
    <section className="container page" style={{ paddingTop: 48 }}>
      <div className="rule-bold" style={{ marginBottom: 28 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
        <span className="kicker">ISSUE 04 · Tendril Swap</span>
        <span className="serif" style={{ color: "var(--gray-d)", fontSize: 15 }}>闪兑 · 免税直连互换</span>
      </div>
      <h1 style={{ marginBottom: 18 }}>
        TENDRIL <em className="em-gold">⇄</em> TVS
      </h1>
      <p className="serif" style={{ color: "var(--gray)", fontSize: 16, maxWidth: 680, marginBottom: 40 }}>
        直连 PancakeSwap V2 Router，固定路径 <span className="mono" style={{ color: "var(--gold-l)" }}>[TENDRIL, TVS] / [TVS, TENDRIL]</span>。
        本平台收取 <b style={{ color: "var(--gold-l)" }}>3% 通道费（进出双向）</b>进入平台钱包，剩余 97% 走同一个直连池；
        池子与流动性完全不动，直连池两端代币税均不触发。
      </p>

      <div className="swap-layout">
        {/* ===== 交换面板 ===== */}
        <div className="swap-panel">
          <div className="swap-tabs">
            {(["buy", "sell", "liqadd", "liqremove"] as Tab[]).map((t) => (
              <button key={t} className={`swap-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                {t === "buy" ? "买入 TVS" : t === "sell" ? "卖出 TVS" : t === "liqadd" ? "加流动性" : "移除流动性"}
              </button>
            ))}
          </div>

          {(tab === "buy" || tab === "sell") && (
            <>
              <div className="token-io">
                <div className="io-top">
                  <span className="io-lbl">支付</span>
                  <span className="io-bal">{lbl(buy ? ball.t : ball.v)}</span>
                </div>
                <div className="io-main">
                  <input
                    className="io-input"
                    type="number" placeholder="0.0" step="any" min={0} inputMode="decimal" autoComplete="off"
                    value={inAmt}
                    onChange={(e) => setInAmt(e.target.value)}
                  />
                  <span className="token-pill">{inToken}</span>
                </div>
                <div className="io-sub">
                  <span className="badge-free fee">3% 平台费</span>
                  <button className="link-btn" onClick={() => void handleMax()}>MAX</button>
                </div>
              </div>

              <div className="flip-arrow" onClick={() => setTab(buy ? "sell" : "buy")} title="切换买卖方向">⇅</div>

              <div className="token-io">
                <div className="io-top">
                  <span className="io-lbl">获得（预估）</span>
                  <span className="io-bal">{lbl(buy ? ball.v : ball.t)}</span>
                </div>
                <div className="io-main">
                  <input className="io-input" type="text" placeholder="0.0" readOnly value={outAmt} />
                  <span className="token-pill token-v">{outToken}</span>
                </div>
                <div className="io-sub">
                  <span className="io-muted">{minOut}</span>
                  <span />
                </div>
              </div>

              <div className="rate-line">{rateLine || "1 TENDRIL ≈ -- TVS"}</div>
            </>
          )}

          {(tab === "liqadd") && (
            <>
              <div className="token-io">
                <div className="io-top">
                  <span className="io-lbl">TENDRIL 投入</span>
                  <span className="io-bal">{lbl(ball.t)}</span>
                </div>
                <div className="io-main">
                  <input className="io-input" type="number" placeholder="0.0" step="any" min={0} value={liqT} onChange={(e) => setLiqT(e.target.value)} />
                  <span className="token-pill">TENDRIL</span>
                </div>
                <div className="io-sub"><span className="io-muted" /><button className="link-btn" onClick={() => setLiqT(ethers.formatEther(ball.t ?? 0n))}>MAX</button></div>
              </div>
              <div className="token-io mt-16">
                <div className="io-top">
                  <span className="io-lbl">TVS 投入（按池比例自动填）</span>
                  <span className="io-bal">{lbl(ball.v)}</span>
                </div>
                <div className="io-main">
                  <input className="io-input" type="number" placeholder="0.0" step="any" min={0} value={liqV} onChange={(e) => setLiqV(e.target.value)} />
                  <span className="token-pill token-v">TVS</span>
                </div>
              </div>
              <div className="io-muted mt-16">{liqHint}</div>
            </>
          )}

          {(tab === "liqremove") && (
            <>
              <div className="token-io">
                <div className="io-top">
                  <span className="io-lbl">LP 数量（TENDRIL-TVS）</span>
                  <span className="io-bal">我的 LP: {ball.lp === null ? "--" : fmt(ball.lp)}</span>
                </div>
                <div className="io-main">
                  <input className="io-input" type="number" placeholder="0.0" step="any" min={0} value={liqLp} onChange={(e) => setLiqLp(e.target.value)} />
                  <span className="token-pill" style={{ color: "var(--gold)" }}>LP</span>
                </div>
                <div className="io-sub"><span className="io-muted" /><button className="link-btn" onClick={() => setLiqLp(ethers.formatEther(ball.lp ?? 0n))}>MAX</button></div>
              </div>
              <div className="io-muted mt-16">{lpHint}</div>
            </>
          )}

          <div className="slip-row">
            <span className="io-lbl">滑点</span>
            <div className="slip-picks">
              {SLIPS.map((s) => (
                <button key={s} className={`slip-pick ${slippage === s ? "on" : ""}`} onClick={() => setSlippage(s)}>
                  {s}%
                </button>
              ))}
            </div>
          </div>

          <div className="io-muted" style={{ minHeight: 18 }}>{authHint}</div>

          <button className="btn btn-gold btn-block btn-lg" onClick={() => void handleAction()} disabled={busy}>
            {busy ? "交易处理中…" : actionLabel}
          </button>

          {txHash && (
            <div className="io-muted" style={{ textAlign: "center", marginTop: 14 }}>
              <a href={`${EXPLORER_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--gold-l)" }}>
                {txHash.slice(0, 18)}… ↗
              </a>
            </div>
          )}

          {warn && (
            <div className={`swap-warn ${warn.danger ? "danger" : ""}`}>{warn.text}</div>
          )}
        </div>

        {/* ===== 池子信息 ===== */}
        <aside className="swap-aside">
          <div className="swap-card">
            <h4>直连池状态</h4>
            <div className="dl-list">
              <div className="dl-row"><span>池子地址</span><b className="mono">{addrS(swapConfig.pair)}</b></div>
              <div className="dl-row"><span>TENDRIL 储备</span><b className="mono">{pool ? fmt(pool.resT, 2) : "--"}</b></div>
              <div className="dl-row"><span>TVS 储备</span><b className="mono">{pool ? fmt(pool.resV, 2) : "--"}</b></div>
              <div className="dl-row"><span>1 TENDRIL ≈</span><b className="mono">{pool ? `${fmt(pool.price, 6)} TVS` : "--"}</b></div>
              <div className="dl-row"><span>TVS 阶段</span><b className="mono">{st} ({pool?.stateNum ?? "--"})</b></div>
              <div className="dl-row"><span>TVS 买 / 卖税</span><b className="mono">{pool ? `${pool.buyTaxPct}% / ${pool.sellTaxPct}%` : "--"}</b></div>
              <div className="dl-row"><span>直连池登记</span><b className="mono" style={{ color: pool?.registered ? "var(--red)" : "var(--green-l)" }}>
                {pool ? (pool.registered ? "已登记 — 会征税 ⚠" : "未登记 — 免税") : "--"}
              </b></div>
              <div className="dl-row"><span>老币 30% 卖税</span><b className="mono" style={{ color: "var(--gray-d)" }}>仅 USDT 主池生效</b></div>
              <div className="dl-row"><span>平台通道费</span><b className="mono" style={{ color: "var(--gold-l)" }}>3% · 进出双向</b></div>
              <div className="dl-row"><span>平台钱包</span><b className="mono" style={{ color: "var(--gold-l)" }}>{addrS(swapConfig.feeRecipient)}</b></div>
              <div className="dl-row"><span>网络</span><b className="mono">BSC Mainnet · 56</b></div>
            </div>
          </div>

          <div className="swap-card">
            <h4>固定路径</h4>
            <p className="io-muted">
              老币买新币：<span className="mono" style={{ color: "var(--gold-l)" }}>TENDRIL → TVS</span>
            </p>
            <p className="io-muted">
              卖新币：<span className="mono" style={{ color: "var(--gold-l)" }}>TVS → TENDRIL</span>
            </p>
            <p className="io-muted mt-16">
              Pancake V2 Router · <span className="mono">{addrS(swapConfig.router)}</span><br />
              不部署自定义合约，免税直连。
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}