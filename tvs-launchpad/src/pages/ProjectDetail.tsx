import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Contract } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import { useProjectDetail } from "../lib/data";
import { ProgressBar, StatusBadge } from "../components/ui";
import { readVault, switchToChain, vaultAbi, publicProvider } from "../lib/chain";
import { conceptDisplay } from "../lib/concepts";
import { fmtCountdown, fmtNumber, fmtPrice } from "../lib/format";
import { config, EXPLORER_BASE } from "../config";
import { verifyStatus } from "../lib/api";
import { PlaceholderBanner } from "../components/PlaceholderBanner";

const zero = BigInt(0);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略 */
    }
  };
  return (
    <button
      onClick={() => void copy()}
      className="mono"
      style={{ marginLeft: 10, border: "1px solid var(--rule)", padding: "2px 8px", fontSize: 10, color: copied ? "var(--gold-bright)" : "var(--paper-3)", background: "transparent", cursor: "pointer" }}
      title="复制地址"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

export default function ProjectDetail() {
  const { address = "" } = useParams();
  const navigate = useNavigate();
  const { account, signer, connect, chainId } = useWallet();
  const toast = useToast();
  const { project, vault, loading, error, refresh } = useProjectDetail(address, account);

  const [qty, setQty] = useState(1);
  const [minting, setMinting] = useState(false);
  const [canRefund, setCanRefund] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [verifyJob, setVerifyJob] = useState<unknown>(null);
  const [unpaidDividend, setUnpaidDividend] = useState<bigint>(zero);
  const [wlInput, setWlInput] = useState("");
  const [savingWl, setSavingWl] = useState(false);
  const [togglingWl, setTogglingWl] = useState(false);
  const [wlCount, setWlCount] = useState(0);
  const [wlAllowance, setWlAllowance] = useState<bigint | null>(null);
  const [wlRemaining, setWlRemaining] = useState<bigint | null>(null);
  const isCreator = Boolean(account && project && account.toLowerCase() === project.creator.toLowerCase());

  const concept = conceptDisplay(project?.templateId || "");

  // 我的未领取分红（持币自动分红）
  useEffect(() => {
    let mounted = true;
    if (!project?.address || !account) {
      setUnpaidDividend(zero);
      return;
    }
    void (async () => {
      try {
        const t = new Contract(project.address, ["function unpaidDividend(address) view returns (uint256)"], publicProvider);
        const value = await t.unpaidDividend(account);
        if (mounted) setUnpaidDividend(BigInt(value ?? 0));
      } catch {
        if (mounted) setUnpaidDividend(zero);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [project?.address, account]);

  useEffect(() => {
    let mounted = true;
    if (!project?.vault || !account) {
      setCanRefund(false);
      return;
    }
    void (async () => {
      try {
        const ok = await readVault(project.vault).canRefund(account);
        if (mounted) setCanRefund(Boolean(ok));
      } catch {
        if (mounted) setCanRefund(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [project?.vault, account, vault?.finalized, vault?.mintedCount]);

  useEffect(() => {
    let mounted = true;
    if (!project?.vault) {
      setWlAllowance(null);
      setWlRemaining(null);
      return;
    }
    void (async () => {
      try {
        const v = readVault(project.vault);
        const [allowTotal, remaining] = await Promise.all([
          v.totalWhitelistAllowance().catch(() => 0n),
          account ? v.whitelistRemaining(account).catch(() => 0n) : 0n,
        ]);
        if (mounted) {
          setWlAllowance(BigInt(allowTotal ?? 0));
          setWlRemaining(BigInt(remaining ?? 0));
        }
      } catch {
        /* 忽略 */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [project?.vault, account, vault?.whitelistMintedCount, vault?.mintedCount]);

  useEffect(() => {
    if (!config.contractsReady) return;
    void verifyStatus(address)
      .then((r) => setVerifyJob(r.job))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const quote = useMemo(() => {
    if (!vault) return zero;
    return vault.mintPrice * BigInt(qty);
  }, [vault, qty]);

  const nowSec = Math.floor(Date.now() / 1000);
  const refundCountdown = vault ? Number(vault.refundDeadline) - nowSec : 0;
  const inRefundWindow = vault && !vault.finalized && vault.mintedCount < vault.totalMints && refundCountdown > 0;
  const soldOut = vault ? vault.mintedCount >= vault.totalMints : false;

  const handleMint = async () => {
    if (!signer || !project?.vault) return;
    setMinting(true);
    setTxHash("");
    try {
      await switchToChain(signer.provider as never);
      const vaultContract = new Contract(project.vault, vaultAbi, signer);
      const tx = await vaultContract.mint(qty, { value: quote });
      setTxHash(tx.hash);
      toast("铸造交易已广播…", "info");
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        toast("✓ 铸造成功", "ok");
        void refresh();
      } else {
        toast("交易上链但状态异常", "err");
      }
    } catch (e) {
      const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage || e.message : "铸造失败";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(msg, "err");
    } finally {
      setMinting(false);
    }
  };

  const handleRefund = async () => {
    if (!signer || !project?.vault) return;
    setRefunding(true);
    try {
      const vaultContract = new Contract(project.vault, vaultAbi, signer);
      const tx = await vaultContract.claimRefund();
      toast("退款交易已广播…", "info");
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        toast("✓ 退款成功", "ok");
        void refresh();
      } else {
        toast("退款交易状态异常", "err");
      }
    } catch (e) {
      const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage || e.message : "退款失败";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(msg, "err");
    } finally {
      setRefunding(false);
    }
  };

  /** 解析白名单地址输入（逗号/空格/换行分隔，去重，最多 200） */
  const parseWl = (text: string): string[] =>
    [
      ...new Set(
        String(text || "")
          .replace(/[\s,;]+/g, " ")
          .trim()
          .split(" ")
          .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)),
      ),
    ].slice(0, 200);

  const handleSaveWhitelist = async () => {
    if (!signer || !project?.vault || !isCreator) return;
    const accounts = parseWl(wlInput);
    if (accounts.length === 0) {
      toast("请填写至少一个有效地址（0x + 40 位十六进制）", "err");
      return;
    }
    setSavingWl(true);
    try {
      const v = new Contract(project.vault, vaultAbi, signer);
      const tx = await v.setWhitelistAllowances(accounts, accounts.map(() => BigInt(1)));
      toast("白名单写入交易已广播…", "info");
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        toast(`✓ 已写入 ${accounts.length} 个白名单地址`, "ok");
        setWlInput("");
        void refresh();
      } else {
        toast("交易上链但状态异常", "err");
      }
    } catch (e) {
      const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage || e.message : "白名单写入失败";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(msg, "err");
    } finally {
      setSavingWl(false);
    }
  };

  const handleToggleWhitelist = async () => {
    if (!signer || !project?.vault || !isCreator || !vault) return;
    setTogglingWl(true);
    try {
      const v = new Contract(project.vault, vaultAbi, signer);
      const tx = await v.setWhitelistEnabled(!vault.whitelistEnabled);
      toast("切换白名单模式交易已广播…", "info");
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        toast(vault.whitelistEnabled ? "✓ 已关闭白名单" : "✓ 已开启白名单", "ok");
        void refresh();
      } else {
        toast("交易上链但状态异常", "err");
      }
    } catch (e) {
      const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage || e.message : "切换失败";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(msg, "err");
    } finally {
      setTogglingWl(false);
    }
  };

  if (!config.contractsReady) {
    return (
      <section className="container page">
        <PlaceholderBanner />
        <div className="empty-state">
          <div className="es-mark">‡</div>
          <p>TVS 专属合约尚未部署，项目详情与铸造将在部署后启用。</p>
          <Link to="/projects" className="btn">返回项目索引</Link>
        </div>
      </section>
    );
  }

  if (loading && !project) {
    return (
      <section className="container page">
        <div className="rule" style={{ marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 56, width: 360, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 20, width: 240 }} />
      </section>
    );
  }

  if (error && !project) {
    return (
      <section className="container page">
        <div className="empty-state">
          <div className="es-mark">‡</div>
          <p className="err-text">无法读取该项目：{error}</p>
          <Link to="/projects" className="btn">返回项目索引</Link>
        </div>
      </section>
    );
  }

  if (!project) return null;

  const status = vault ? (vault.finalized ? "finalized" : soldOut ? "soldout" : inRefundWindow ? "refunding" : "open") : "unknown";

  return (
    <section className="container page" style={{ paddingTop: 16 }}>
      <PlaceholderBanner />

      {/* 工具条 */}
      <div className="toolbar">
        <button className="btn" onClick={() => navigate(-1)}>← 返回</button>
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>刷新 ↗</button>
      </div>

      {/* 头部 */}
      <div className="detail-head">
        <div className="hero-anim hero-anim-1">
          <div className="dh-meta">
            <span>{concept.label}</span>
            <span>·</span>
            <StatusBadge status={status} />
            <span>·</span>
            <span>{verifyJob ? "VERIFY QUEUED" : "VERIFY PENDING"}</span>
          </div>
          <div className="flex center" style={{ gap: 18, marginBottom: 16 }}>
            {project.avatar ? (
              <img src={project.avatar} alt={project.name} style={{ width: 64, height: 64, border: "1px solid var(--rule-strong)", objectFit: "cover", flex: "none" }} />
            ) : (
              <div style={{ width: 64, height: 64, border: "1px solid var(--rule-strong)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--paper-3)", flex: "none" }}>
                {project.symbol.slice(0, 4) || "TKN"}
              </div>
            )}
            <h1 className="dh-title" style={{ margin: 0 }}>
              <small>{concept.label.toUpperCase()}</small>
              {project.name || "Unnamed"} <span className="em-gold">· {project.symbol}</span>
            </h1>
          </div>
          {project.description ? (
            <p className="dh-quote" style={{ fontStyle: "normal" }}>{project.description}</p>
          ) : (
            <p className="dh-quote" style={{ fontSize: 14 }}>
              由 <b style={{ color: "var(--paper)" }}>{project.creator.slice(0, 8)}…</b> 创建于 {new Date(Number(project.createdAt) * 1000).toLocaleDateString()} ·
              分红代币 {project.rewardToken === "0x0000000000000000000000000000000000000000" ? "USDT" : `${project.rewardToken.slice(0, 8)}…`} ·
              分红门槛 {fmtNumber(project.rewardThreshold, 18, 0)}
            </p>
          )}
        </div>
      </div>

      {/* 主区 */}
      <div className="detail-grid">
        <div>
          {/* 信息四格 */}
          <div className="info-quad">
            <div className="iq-cell">
              <div className="iq-label">单次价格</div>
              <div className="iq-val">{vault ? fmtPrice(vault.mintPrice) : "—"} <small>{config.nativeSymbol}</small></div>
            </div>
            <div className="iq-cell">
              <div className="iq-label">单钱包上限</div>
              <div className="iq-val">{vault && vault.maxMintPerWallet > zero ? `${vault.maxMintPerWallet.toLocaleString()} 份` : "不限"}</div>
            </div>
            <div className="iq-cell">
              <div className="iq-label">代币合约</div>
              <div className="flex center" style={{ gap: 6, flexWrap: "wrap" }}>
                <span className="addr" title="点击复制" onClick={() => void navigator.clipboard?.writeText(project.address).catch(() => {})}>
                  {project.address.slice(0, 8)}…{project.address.slice(-6)}
                </span>
                <CopyButton text={project.address} />
                <a className="mono" style={{ fontSize: 12, color: "var(--gold-bright)" }} href={`${EXPLORER_BASE}/token/${project.address}`} target="_blank" rel="noreferrer">↗</a>
              </div>
            </div>
            <div className="iq-cell">
              <div className="iq-label">金库</div>
              <div className="flex center" style={{ gap: 6, flexWrap: "wrap" }}>
                <span className="addr" title="点击复制" onClick={() => void navigator.clipboard?.writeText(project.vault).catch(() => {})}>
                  {project.vault.slice(0, 8)}…{project.vault.slice(-6)}
                </span>
                <CopyButton text={project.vault} />
                <a className="mono" style={{ fontSize: 12, color: "var(--gold-bright)" }} href={`${EXPLORER_BASE}/address/${project.vault}`} target="_blank" rel="noreferrer">↗</a>
              </div>
            </div>
          </div>

          {/* 白名单管理 */}
          {vault && !vault.finalized && (
            <div className="wl-box">
              <div className="flex between center" style={{ marginBottom: 10 }}>
                <span className="kicker" style={{ margin: 0 }}>Whitelist · 白名单管理</span>
                <button
                  className="btn btn-sm"
                  onClick={() => void handleToggleWhitelist()}
                  disabled={!isCreator || togglingWl || !config.contractsReady || !chainId || chainId !== config.chainId}
                  title={isCreator ? "" : "仅创建者（金库 Owner）可操作"}
                >
                  {togglingWl ? "广播中…" : vault.whitelistEnabled ? "关闭白名单" : "开启白名单"}
                </button>
              </div>
              <p className="serif" style={{ color: "var(--paper-3)", fontSize: 14, marginBottom: 12 }}>
                {isCreator
                  ? `你是创建者（金库 Owner）。写入白名单地址后，对应钱包即可在白名单阶段 Mint。当前白名单阶段${vault.whitelistEnabled ? "已开启" : "已关闭"}。`
                  : "白名单管理仅创建者（金库 Owner）可见可操作。其他用户可在此本地查看配额与进度。"}
              </p>
              <div className="mono" style={{ fontSize: 12, color: "var(--paper-3)", letterSpacing: ".04em", marginBottom: 14 }}>
                已添加 {wlAllowance !== null ? wlAllowance.toLocaleString() : "—"} 个地址 · 配额 {project.whitelistMintCount.toLocaleString()} 次 · 已售 {vault.whitelistMintedCount.toLocaleString()} 次
              </div>
              {isCreator && (
                <>
                  <textarea
                    className="input mono"
                    style={{ minHeight: 110, fontSize: 13 }}
                    placeholder={"0x....\n0x....\n（每行一个，最多 200 个；已写入的地址重复填入会跳过/覆盖）"}
                    value={wlInput}
                    onChange={(e) => {
                      setWlInput(e.target.value);
                      setWlCount(parseWl(e.target.value).length);
                    }}
                  />
                  <div className="input-hint" style={{ marginTop: 8 }}>
                    {wlCount > 0 ? `已解析 ${wlCount} 个有效地址` : "支持逗号 / 空格 / 换行分隔，单次最多 200 个"}
                  </div>
                  <button
                    className="btn btn-gold mt-16"
                    onClick={() => void handleSaveWhitelist()}
                    disabled={savingWl || !config.contractsReady || !chainId || chainId !== config.chainId}
                  >
                    {savingWl ? "广播中…" : wlCount > 0 ? `写入 ${wlCount} 个地址 →` : "写入白名单 →"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* 数据 */}
          <div className="kicker" style={{ marginBottom: 16 }}>Vault · 金库</div>
          <div className="dl-list" style={{ marginBottom: 40 }}>
            <div className="dl-row"><span>Total Supply</span><b className="mono">{fmtNumber(project.totalSupply)}</b></div>
            <div className="dl-row"><span>LP Reserve (50%)</span><b className="mono">{fmtNumber(vault?.liquidityTokenReserve ?? project.totalSupply / BigInt(2))}</b></div>
            <div className="dl-row"><span>Per Mint</span><b className="mono">{fmtNumber(vault?.tokensPerMint ?? zero, 18, 2)}</b></div>
            <div className="dl-row"><span>Minted / Cap</span><b className="mono">{vault ? `${vault.mintedCount.toLocaleString()} / ${vault.totalMints.toLocaleString()}` : "—"}</b></div>
            <div className="dl-row"><span>Whitelist Sold</span><b className="mono">{vault?.whitelistMintedCount.toLocaleString() ?? "—"}</b></div>
            <div className="dl-row"><span>Public Sold</span><b className="mono">{vault?.publicMintedCount.toLocaleString() ?? "—"}</b></div>
            <div className="dl-row"><span>Per Wallet Cap</span><b className="mono">{vault && vault.maxMintPerWallet > zero ? vault.maxMintPerWallet.toLocaleString() : "Unlimited"}</b></div>
          </div>

          <div className="kicker" style={{ marginBottom: 16 }}>Tax Engine · 税费引擎</div>
          <div className="dl-list">
            <div className="dl-row"><span>Buy Tax</span><b className="mono">{project.buyTaxBps ? `${(project.buyTaxBps / 100).toFixed(2)}%` : "0%"}</b></div>
            <div className="dl-row"><span>Sell Tax</span><b className="mono">{project.sellTaxBps ? `${(project.sellTaxBps / 100).toFixed(2)}%` : "0%"}</b></div>
            <div className="dl-row"><span>Transfer Tax</span><b className="mono">{project.transferTaxBps ? `${(project.transferTaxBps / 100).toFixed(2)}%` : "0%"}</b></div>
            <div className="dl-row"><span>Add LP Tax</span><b className="mono">{project.addLiquidityTaxBps ? `${(project.addLiquidityTaxBps / 100).toFixed(2)}%` : "0%"}</b></div>
            <div className="dl-row"><span>Remove LP Tax</span><b className="mono">{project.removeLiquidityTaxBps ? `${(project.removeLiquidityTaxBps / 100).toFixed(2)}%` : "0%"}</b></div>
            <div className="dl-row"><span>Launch Protection</span><b className="mono">{project.launchProtectionTaxBps ? `${(project.launchProtectionTaxBps / 100).toFixed(2)}% × ${project.launchProtectionBlocks} blocks` : "0%"}</b></div>
            <div className="dl-row"><span>Refund Window</span><b className="mono">{project.claimWait ? `${project.claimWait}s` : "Disabled"}</b></div>
            <div className="dl-row"><span>Distribution · Fund/LP/Div/Burn</span><b className="mono">{project.fundFeeBps / 100}% / {project.lpFeeBps / 100}% / {project.dividendFeeBps / 100}% / {project.burnFeeBps / 100}%</b></div>
          </div>

          <p className="serif" style={{ color: "var(--paper-3)", fontSize: 13, lineHeight: 1.8, marginTop: 32, maxWidth: 640 }}>
            参与即表示你理解 Meme 代币的风险：价格可能归零、退款仅在未售罄且退款窗口内生效、锁池发生在售罄 finalize 时。
            DCA、DYOR。本页数据来自 BSC 链上实时读取，交易经由你的钱包签名，私钥永不上传。
          </p>
        </div>

        {/* Mint 侧栏 */}
        <aside className="mint-panel">
          <div className="mint-head">Mint</div>
          <div className="mint-price">
            {vault ? fmtPrice(vault.mintPrice) : "—"}<small>{config.nativeSymbol}</small>
          </div>
          <div className="mt-24">
            <ProgressBar value={vault?.progressBps ?? 0} />
            <div className="mint-progress">
              <span>Progress</span>
              <b>{vault ? `${vault.mintedCount.toLocaleString()} / ${vault.totalMints.toLocaleString()}` : "—"}</b>
            </div>
          </div>

          {vault?.whitelistEnabled && (
            <div className="mono" style={{ border: "1px solid var(--rule-gold)", padding: 12, fontSize: 11, marginBottom: 16, letterSpacing: ".06em" }}>
              WHITELIST PHASE {account && vault.whitelisted ? "· YOU'RE IN" : "· WALLET NOT LISTED"}
            </div>
          )}
          {vault?.whitelistEnabled && account && vault.whitelisted && wlRemaining !== null && (
            <div className="mono" style={{ fontSize: 11, color: "var(--green-bright)", marginBottom: 16, letterSpacing: ".06em" }}>
              白名单剩余份额 {wlRemaining.toLocaleString()} 份
            </div>
          )}

          {account && project.dividendFeeBps > 0 && (
            <div className="flex between center" style={{ padding: "12px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)", marginBottom: 16 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--paper-3)" }}>我的分红 · Unpaid</span>
              <b className="serif" style={{ color: "var(--gold-bright)", fontSize: 17, fontWeight: 600 }}>{fmtNumber(unpaidDividend, 18, 4)}</b>
            </div>
          )}

          {vault?.finalized ? (
            <>
              <p className="serif" style={{ fontSize: 14, lineHeight: 1.6, padding: 14, border: "1px solid var(--gold)" }}>
                ✓ 发射已完成：LP 已锁黑洞，代币已流通，进入二级市场交易阶段。
              </p>
              <a
                className="btn btn-gold btn-block mt-24"
                href={`https://pancakeswap.finance/swap?outputCurrency=${project.address}`}
                target="_blank"
                rel="noreferrer"
              >
                去 PancakeSwap 交易 →
              </a>
            </>
          ) : account && soldOut ? (
            <p className="serif" style={{ fontSize: 14, lineHeight: 1.6, padding: 14, border: "1px solid var(--rule)" }}>
              全部 Mint 已售罄，进入 finalize / 锁池流程。
            </p>
          ) : account && vault ? (
            <>
              <div className="qty">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <input type="text" value={qty} readOnly />
                <button onClick={() => setQty((q) => q + 1)}>+</button>
              </div>
              {vault.maxMintPerWallet > zero && (
                <div className="mono" style={{ fontSize: 11, color: "var(--paper-3)", letterSpacing: ".04em", marginTop: 6 }}>
                  上限 {vault.maxMintPerWallet.toLocaleString()} · 已用 {vault.mintedByWallet.toLocaleString()} · 剩余 {Math.max(0, Number(vault.maxMintPerWallet - vault.mintedByWallet))}
                </div>
              )}
              <div className="mint-total">
                <small>合计 / Total</small>
                <b>{fmtPrice(quote)} {config.nativeSymbol}</b>
              </div>
              <button
                className="btn btn-gold btn-block"
                onClick={() => void handleMint()}
                disabled={minting || !config.contractsReady || chainId !== config.chainId || (vault.whitelistEnabled && !vault.whitelisted)}
              >
                {config.contractsReady
                  ? minting
                    ? "广播中…"
                    : "立即铸造 →"
                  : "合约待部署 · 预览"}
              </button>
              {!config.contractsReady && (
                <p className="mint-note">{config.placeholderNote}</p>
              )}
            </>
          ) : (
            <button className="btn btn-gold btn-block" onClick={() => void connect()}>连接钱包开始铸造</button>
          )}

          {inRefundWindow && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--rule)", fontSize: 12, textAlign: "center" }}>
              退款窗口剩余 <b style={{ color: "var(--gold-bright)" }}>{fmtCountdown(refundCountdown)}</b>
              {canRefund && (
                <button className="btn btn-sm mt-16" onClick={() => void handleRefund()} disabled={refunding}>
                  {refunding ? "广播中…" : "我要退款"}
                </button>
              )}
            </div>
          )}

          {txHash && (
            <div style={{ marginTop: 16, textAlign: "center", fontSize: 12 }}>
              <a href={`${EXPLORER_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer" className="mono" style={{ borderBottom: "1px solid var(--rule)" }}>
                {txHash.slice(0, 14)}…
              </a>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}