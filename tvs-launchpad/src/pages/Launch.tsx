import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Contract, ZeroAddress, id as keccakId, parseUnits } from "ethers";
import type { Signer } from "ethers";
import { useWallet } from "../wallet";
import { useToast } from "../components/Toast";
import { PlaceholderBanner } from "../components/PlaceholderBanner";
import { readFactory, switchToChain, vaultAbi } from "../lib/chain";
import { CONCEPTS } from "../lib/concepts";
import { deployMintLaunch, type DeployResult } from "../lib/vanity";
import { uploadAsset } from "../lib/api";
import type { LaunchParams } from "../types";
import { config, EXPLORER_BASE, fmtAddress as fmtShort } from "../config";
import { parseBNB } from "../lib/format";

const STEPS = [
  { n: "01", t: "代币与概念" },
  { n: "02", t: "融资机制" },
  { n: "03", t: "税费与分红" },
  { n: "04", t: "确认与部署" },
];
const BPS_MAX = 2500;
const SPLIT_MAX = 10000;

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"];
const AVATAR_MAX_BYTES = 1024 * 1024;
const AVATAR_SIZE = 256;

interface FormState {
  name: string;
  symbol: string;
  conceptKey: string;
  description: string;
  avatar: string;
  telegram: string;
  xLink: string;
  website: string;
  totalSupply: string;
  /** 公开铸造次数（mintCount = public + whitelist） */
  publicMintCount: string;
  /** 白名单铸造次数（>0 时自动启用白名单） */
  whitelistMintCount: string;
  mintPrice: string;
  maxMintPerWallet: string;
  whitelistEnabled: boolean;
  /** 白名单地址列表（每行一个，部署后批量写入金库） */
  whitelistAddresses: string;
  claimWaitSeconds: string;
  buyTaxBps: number;
  sellTaxBps: number;
  transferTaxBps: number;
  addLiquidityTaxBps: number;
  removeLiquidityTaxBps: number;
  launchProtectionTaxBps: number;
  launchProtectionBlocks: string;
  fundFeeBps: number;
  lpFeeBps: number;
  dividendFeeBps: number;
  burnFeeBps: number;
  /** 接收钱包（默认=连接钱包） */
  receiver: string;
  /** 分红代币地址（默认 USDT） */
  rewardToken: string;
  /** 持仓分红门槛（代币数量） */
  rewardThreshold: string;
}

const INITIAL: FormState = {
  name: "",
  symbol: "",
  conceptKey: "tvs-rwa",
  description: "",
  avatar: "",
  telegram: "",
  xLink: "",
  website: "",
  totalSupply: "100000000",
  publicMintCount: "270",
  whitelistMintCount: "30",
  mintPrice: "0.00001",
  maxMintPerWallet: "1",
  whitelistEnabled: false,
  whitelistAddresses: "",
  claimWaitSeconds: "60",
  buyTaxBps: 0,
  sellTaxBps: 0,
  transferTaxBps: 0,
  addLiquidityTaxBps: 0,
  removeLiquidityTaxBps: 0,
  launchProtectionTaxBps: 0,
  launchProtectionBlocks: "0",
  fundFeeBps: 0,
  lpFeeBps: 0,
  dividendFeeBps: 0,
  burnFeeBps: 0,
  receiver: "",
  rewardToken: config.defaultRewardToken,
  rewardThreshold: "0",
};

/** 解析白名单地址列表（逗号/空格/换行分隔，去重，最多 200） */
function parseWhitelistAddresses(text: string): string[] {
  const raw = String(text || "")
    .replace(/[\s,;]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return [...new Set(raw.map((a) => a.trim()).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)))].slice(0, 200);
}
const whitelistCount = (text: string) => parseWhitelistAddresses(text).length;

/** 分红代币地址归一化：空/无效回退 USDT */
function normalizeRewardToken(value: string): string {
  const v = String(value || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? v : config.defaultRewardToken;
}

/** 持仓门槛解析 */
function parseRewardThreshold(value: string): bigint {
  const v = String(value || "0").trim();
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return BigInt(0);
  return parseBNB(v);
}

/** Canvas 压缩头像到 256×256 JPEG */
function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > AVATAR_MAX_BYTES) {
      reject(new Error("图片建议小于 1MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 不可用"));
          return;
        }
        ctx.drawImage(img, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("图片读取失败"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

/** 构建链上 metadata JSON（description/avatar/website/telegram/x） */
async function buildMetadata(form: FormState): Promise<string> {
  const meta: Record<string, string> = {
    description: form.description.trim().slice(0, 480),
    website: form.website.trim().slice(0, 480),
    telegram: form.telegram.trim().slice(0, 480),
    x: form.xLink.trim().slice(0, 480),
  };
  let avatarUrl = "";
  if (form.avatar) {
    if (form.avatar.startsWith("data:")) {
      try {
        const asset = await uploadAsset(form.avatar);
        avatarUrl = asset.url;
      } catch {
        /* 上传失败则头像为空 */
      }
    } else {
      avatarUrl = form.avatar;
    }
  }
  meta.avatar = avatarUrl;
  const json = JSON.stringify(meta);
  // 链上 metadataUri 上限 4096 字节：超限则裁头像与简介
  if (new TextEncoder().encode(json).length > 4096) {
    meta.avatar = "";
    meta.description = form.description.trim().slice(0, 180);
    return JSON.stringify(meta);
  }
  return json;
}

function Range({
  label,
  value,
  onChange,
  max = BPS_MAX,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="range">
      <span>{label}</span>
      <input type="range" min={0} max={max} step={25} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="v">{(value / 100).toFixed(2)}%</span>
    </div>
  );
}

export default function Launch() {
  const { account, signer, connect, chainId } = useWallet();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [suffix, setSuffix] = useState(config.vanitySuffix);
  const [creationFee, setCreationFee] = useState("0.005");
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [feeInfo, setFeeInfo] = useState<{ feeRecipient: string; tokenDeployer: string } | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // 钱包连接后自动填入接收钱包
  useEffect(() => {
    if (account && !form.receiver) {
      set("receiver", account);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // 读取链上工厂参数（占位模式下读取失败则保持默认）
  useEffect(() => {
    if (!config.contractsReady) return;
    void (async () => {
      try {
        const f = readFactory();
        const [sufRaw, fee, recipient, deployer] = await Promise.all([
          f.requiredTokenSuffix(),
          f.creationFee(),
          f.feeRecipient(),
          f.tokenDeployer(),
        ]);
        if (Number(sufRaw) > 0) setSuffix(Number(sufRaw).toString(16).padStart(4, "0"));
        if (fee) setCreationFee(String(Number(fee) / 1e18));
        setFeeInfo({ feeRecipient: String(recipient), tokenDeployer: String(deployer) });
      } catch {
        /* RPC 未通 */
      }
    })();
  }, []);

  const templateId = useMemo(
    () => keccakId(CONCEPTS.find((c) => c.key === form.conceptKey)?.key ?? "tvs-rwa"),
    [form.conceptKey],
  );

  const allocationTotal = form.lpFeeBps + form.dividendFeeBps + form.burnFeeBps;
  /** Fund 资金池为剩余项，四档总和恒为 100% */
  const fundAutoBps = SPLIT_MAX - allocationTotal;
  const totalSupplyNum = Number(form.totalSupply) || 0;
  const saleSupply = Math.floor((totalSupplyNum * 5000) / 10000);
  /** 总铸造次数 = 公开 + 白名单 */
  const totalMintCount =
    (Number(form.publicMintCount) || 0) + (Number(form.whitelistMintCount) || 0);
  /** 白名单次数 > 0 即视为启用白名单 */
  const whitelistEnabled =
    form.whitelistEnabled || Number(form.whitelistMintCount) > 0;
  const perMint = totalMintCount > 0 ? Math.floor(saleSupply / totalMintCount) : 0;

  const validate = (s: number): string | null => {
    if (s === 0) {
      if (!form.name.trim()) return "请填写代币名称";
      if (!/^[A-Za-z0-9]{2,12}$/.test(form.symbol.trim())) return "代币符号需为 2-12 位字母数字";
      if (!(totalSupplyNum > 0) || !Number.isInteger(totalSupplyNum)) return "总供应量需为正整数";
    }
    if (s === 1) {
      if (!(parseFloat(form.mintPrice) > 0)) return "铸造价格必须大于 0";
      if (!(totalMintCount > 0) || !Number.isInteger(Number(form.publicMintCount)) || !Number.isInteger(Number(form.whitelistMintCount)))
        return "公开次数与白名单次数需为非负整数，且总和必须大于 0";
      if (totalMintCount > totalSupplyNum) return "铸造总次数不能超过总供应量";
      if (perMint < 1) return "铸造次数过大，每个 Mint 分不到 1 枚代币";
      if (Number(form.whitelistMintCount) > totalMintCount)
        return "白名单次数不能超过铸造总次数";
      if (form.whitelistEnabled && !(Number(form.whitelistMintCount) > 0))
        return "开启白名单时，白名单次数必须大于 0";
      const wait = Number(form.claimWaitSeconds);
      if (form.claimWaitSeconds !== "" && (!Number.isFinite(wait) || wait < 0 || wait > 86400)) return "分红间隔需在 0-86400 秒（24 小时）";
      if (!/^0x[0-9a-fA-F]{40}$/.test(form.receiver || "")) return "请填写有效的接收钱包地址";
      if (form.rewardToken && !/^0x[0-9a-fA-F]{40}$/.test(form.rewardToken)) return "分红代币地址无效（留空则用 USDT）";
    }
    if (s === 2) {
      if (form.buyTaxBps > BPS_MAX || form.sellTaxBps > BPS_MAX || form.transferTaxBps > BPS_MAX) return "买卖/转账税最高 25%";
      if (form.addLiquidityTaxBps > BPS_MAX || form.removeLiquidityTaxBps > BPS_MAX) return "LP 税最高 25%";
      if (form.launchProtectionTaxBps > BPS_MAX) return "发射保护税最高 25%";
      if (allocationTotal > SPLIT_MAX) return "LP/分红/燃烧总和不能超过 100%（Fund 自动取剩余）";
    }
    return null;
  };

  const goto = (target: number) => {
    const err = validate(step);
    if (err) {
      toast(err, "err");
      return;
    }
    setStep(target);
  };

  const handleAvatar = async (file: File) => {
    if (!AVATAR_TYPES.includes(file.type)) {
      toast("请上传 PNG、JPEG、SVG、GIF 或 WebP 图片", "err");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await compressAvatar(file);
      set("avatar", dataUrl);
    } catch (e) {
      toast(e instanceof Error ? e.message : "图片处理失败", "err");
    } finally {
      setUploading(false);
    }
  };

  /** 部署后批量写入白名单 */
  const writeWhitelist = async (s: Signer, vault: string, accounts: string[]) => {
    try {
      const v = new Contract(vault, vaultAbi, s);
      const allowances = accounts.map(() => BigInt(1));
      const tx = await v.setWhitelistAllowances(accounts, allowances);
      await tx.wait();
      toast(`白名单已写入 ${accounts.length} 个地址`, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "白名单写入失败";
      if (!/user rejected|denied/i.test(msg)) toast(`白名单写入失败：${msg.slice(0, 80)}`, "err");
    }
  };

  const handleDeploy = async () => {
    if (!config.contractsReady) {
      toast(config.placeholderNote, "info");
      return;
    }
    if (!signer || !account) {
      toast("请先连接钱包", "err");
      return;
    }
    if (chainId !== config.chainId) {
      toast(`请切换到 ${config.nativeSymbol} 主网（Chain ${config.chainId}）`, "err");
      return;
    }
    const err = validate(2);
    if (err) {
      toast(err, "err");
      return;
    }
    setDeploying(true);
    try {
      await switchToChain(signer.provider as never);
      const metadataUri = await buildMetadata(form);
      const params: LaunchParams = {
        name: form.name.trim(),
        symbol: form.symbol.trim(),
        metadataUri,
        totalSupply: parseUnits(String(totalSupplyNum), 18),
        mintCount: BigInt(totalMintCount),
        mintPrice: parseBNB(form.mintPrice),
        maxMintPerWallet: BigInt(Number(form.maxMintPerWallet) || 0),
        paymentToken: ZeroAddress,
        rewardToken: normalizeRewardToken(form.rewardToken),
        rewardThreshold: parseRewardThreshold(form.rewardThreshold),
        receiver: form.receiver || account,
        templateId,
        buyTaxBps: form.buyTaxBps,
        sellTaxBps: form.sellTaxBps,
        transferTaxBps: form.transferTaxBps,
        addLiquidityTaxBps: form.addLiquidityTaxBps,
        removeLiquidityTaxBps: form.removeLiquidityTaxBps,
        launchProtectionTaxBps: form.launchProtectionTaxBps,
        launchProtectionBlocks: Number(form.launchProtectionBlocks) || 0,
        claimWait: Number(form.claimWaitSeconds) || 0,
        fundFeeBps: fundAutoBps,
        lpFeeBps: form.lpFeeBps,
        dividendFeeBps: form.dividendFeeBps,
        burnFeeBps: form.burnFeeBps,
        whitelistMintCount: whitelistEnabled ? BigInt(Number(form.whitelistMintCount) || 0) : BigInt(0),
        whitelistEnabled,
      };
      const deployed = await deployMintLaunch(signer, params, suffix, parseUnits(creationFee, 18));
      setResult(deployed);
      toast("发射成功，已自动排队开源验证", "ok");
      // 白名单地址批量写入金库（可选，失败不阻塞成功面板）
      if (deployed.vaultAddress && whitelistEnabled && form.whitelistAddresses.trim()) {
        const accounts = parseWhitelistAddresses(form.whitelistAddresses);
        if (accounts.length > 0) {
          void writeWhitelist(signer, deployed.vaultAddress, accounts);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "部署失败";
      if (/user rejected|denied/i.test(msg)) toast("已取消签名", "info");
      else toast(msg, "err");
    } finally {
      setDeploying(false);
    }
  };

  // ===== 成功面板 =====
  if (result) {
    return (
      <section className="container page" style={{ paddingTop: 48 }}>
        <div className="rule-bold" style={{ marginBottom: 32 }} />
        <div style={{ maxWidth: 640 }}>
          <div className="kicker" style={{ marginBottom: 16 }}>ISSUE 02 · LAUNCHED</div>
          <h1>
            发射<em className="em-gold">成功</em>
          </h1>
          <p className="serif" style={{ color: "var(--paper-2)", fontSize: 17, margin: "18px 0 32px" }}>
            你的代币与金库已部署到 BNB Smart Chain，后端已自动排队 BscScan 开源验证。
          </p>

          <div className="dl-list">
            <div className="dl-row">
              <span>Token</span>
              <b className="mono">
                {result.predictedTokenAddress ? (
                  <a href={`${EXPLORER_BASE}/token/${result.predictedTokenAddress}`} target="_blank" rel="noreferrer" style={{ borderBottom: "1px solid var(--rule-gold)" }}>
                    {result.predictedTokenAddress}
                  </a>
                ) : (
                  result.tokenAddress
                )}
              </b>
            </div>
            <div className="dl-row">
              <span>Tx Hash</span>
              <b className="mono">
                <a href={`${EXPLORER_BASE}/tx/${result.hash}`} target="_blank" rel="noreferrer" style={{ borderBottom: "1px solid var(--rule-gold)" }}>
                  {result.hash}
                </a>
              </b>
            </div>
            <div className="dl-row">
              <span>Vanity</span>
              <b className="mono">0x…{result.vanitySuffix} · 尝试 {result.vanityAttempts.toLocaleString()} 次</b>
            </div>
          </div>

          <div className="flex gap-12" style={{ marginTop: 32, flexWrap: "wrap" }}>
            <Link to={`/project/${result.tokenAddress}`} className="btn btn-gold">查看项目详情 →</Link>
            <Link to="/projects" className="btn">浏览所有发射</Link>
            <button className="btn" onClick={() => setResult(null)}>继续部署</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="container page">
      <PlaceholderBanner />

      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
        <span className="kicker">ISSUE 02 · 发射台</span>
        <span className="serif" style={{ color: "var(--paper-3)", fontSize: 15 }}>Tendril Launchpad</span>
      </div>
      <h1 style={{ marginBottom: 18 }}>
        发射你的<em className="em-gold">第一根藤蔓</em>
      </h1>
      <p className="serif" style={{ color: "var(--paper-2)", fontSize: 17, maxWidth: 640, marginBottom: 44 }}>
        选概念 → 配机制 → 一键发射。后端矿机自动计算 0x…{suffix} 靓号地址，部署后自动排队开源验证。
      </p>

      <div className="wizard">
        <aside className="w-side">
          {STEPS.map((s, i) => (
            <button
              key={s.n}
              className={`w-step ${i === step ? "on" : ""} ${i < step ? "done" : ""}`}
              onClick={() => i < step && setStep(i)}
              disabled={i >= step}
            >
              <span className="n mono">{s.n}</span>
              <span className="t">{s.t}</span>
            </button>
          ))}
        </aside>

        <div className="w-body">
          {/* ===== Step 0 ===== */}
          {step === 0 && (
            <>
              <h2 style={{ marginBottom: 6 }}>代币与概念</h2>
              <p className="lede">先给子币起名。每个概念是链上独立的 templateId，概念即身份。</p>

              <div className="w-section">
                <h3>概念 / Concept</h3>
                <div className="concept-list">
                  {CONCEPTS.map((c, i) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`concept-pick ${form.conceptKey === c.key ? "on" : ""}`}
                      onClick={() => set("conceptKey", c.key)}
                    >
                      <div className="concept-pick-name">{c.emoji} {c.label}</div>
                      <div className="concept-pick-no">{String(i + 1).padStart(2, "0")} · {c.tagline}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-section">
                <h3>基础信息 / Basics</h3>
                <div className="w-grid-2">
                  <div className="field">
                    <label>代币名称</label>
                    <input className="input" placeholder="Tendril First" value={form.name} maxLength={32} onChange={(e) => set("name", e.target.value)} />
                  </div>
                  <div className="field">
                    <label>符号 / Symbol</label>
                    <input className="input" placeholder="TVE / FIRST" value={form.symbol} maxLength={12} onChange={(e) => set("symbol", e.target.value)} />
                  </div>
                </div>
                <div className="field mt-24">
                  <label>简介（随 metadata 上链）</label>
                  <textarea
                    className="input"
                    placeholder="介绍子币定位、玩法或社区信息"
                    value={form.description}
                    maxLength={480}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </div>
              </div>

              <div className="w-section">
                <h3>头像与社区 / Avatar & Socials</h3>
                <div className="w-grid-2">
                  <div className="field">
                    <label>项目头像（压缩 256px 上传）</label>
                    <div className="flex center" style={{ alignItems: "flex-start", gap: 14 }}>
                      {form.avatar ? (
                        <img src={form.avatar} alt="avatar" style={{ width: 72, height: 72, border: "1px solid var(--rule-strong)", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 72, height: 72, border: "1px solid var(--rule-strong)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--paper-3)" }}>
                          {form.symbol.slice(0, 4) || "AVATAR"}
                        </div>
                      )}
                      <div className="flex col" style={{ gap: 8 }}>
                        <input
                          type="file"
                          accept={AVATAR_TYPES.join(",")}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleAvatar(f);
                          }}
                          disabled={uploading}
                          style={{ fontSize: 13, color: "var(--paper-3)" }}
                        />
                        {form.avatar && (
                          <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => set("avatar", "")}>移除</button>
                        )}
                      </div>
                    </div>
                    <div className="input-hint">{uploading ? "处理中…" : "PNG / JPEG / SVG / GIF / WebP，建议小于 1MB。上传后转存后端资产库。"}</div>
                  </div>
                  <div className="flex col" style={{ gap: 16, alignContent: "start" }}>
                    <div className="field">
                      <label>Telegram</label>
                      <input className="input" placeholder="https://t.me/…" value={form.telegram} onChange={(e) => set("telegram", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>X / Twitter</label>
                      <input className="input" placeholder="https://x.com/…" value={form.xLink} onChange={(e) => set("xLink", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>官网</label>
                      <input className="input" placeholder="https://…" value={form.website} onChange={(e) => set("website", e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Step 1 ===== */}
          {step === 1 && (
            <>
              <h2 style={{ marginBottom: 6 }}>融资机制</h2>
              <p className="lede">总供应的 50% 自动预留给流动性，发售即有盘。退款窗口可关闭。</p>

              <div className="w-section">
                <h3>供应 / Supply</h3>
                <div className="w-grid-3">
                  <div className="field">
                    <label>发行总量</label>
                    <input className="input" type="number" min={1} value={form.totalSupply} onChange={(e) => set("totalSupply", e.target.value)} />
                  </div>
                  <div className="field">
                    <label>单次价格 ({config.nativeSymbol})</label>
                    <input className="input" type="number" step="0.0000001" min={0} value={form.mintPrice} onChange={(e) => set("mintPrice", e.target.value)} />
                  </div>
                  <div className="field">
                    <label>总铸造次数（= 公开 + 白名单）</label>
                    <input className="input" value={totalMintCount.toLocaleString()} readOnly style={{ background: "var(--rule)" }} />
                  </div>
                  <div className="field">
                    <label>公开铸造次数</label>
                    <input className="input" type="number" min={0} value={form.publicMintCount} onChange={(e) => set("publicMintCount", e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div className="field">
                    <label>白名单铸造次数</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={form.whitelistMintCount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        set("whitelistMintCount", v);
                        set("whitelistEnabled", Number(v) > 0);
                      }}
                    />
                    <div className="input-hint">填写大于 0 即自动启用白名单阶段。</div>
                  </div>
                </div>
                <div className="serif" style={{ color: "var(--paper-3)", fontSize: 14, marginTop: 16 }}>
                  计算：总供应 50% 预留做市 · 每次 Mint 派发 {perMint.toLocaleString()} 枚代币 · 单地址上限 {Number(form.maxMintPerWallet) > 0 ? form.maxMintPerWallet : "不限"}
                </div>
              </div>

              <div className="w-section">
                <h3>机制 / Mechanisms</h3>
                <div className="w-grid-2">
                  <div className="field">
                    <label>单地址上限（0 = 不限）</label>
                    <input className="input" type="number" min={0} value={form.maxMintPerWallet} onChange={(e) => set("maxMintPerWallet", e.target.value)} />
                  </div>
                  <div className="field">
                    <label>退款等待（秒，0 = 关闭）</label>
                    <input className="input" type="number" min={0} max={86400} value={form.claimWaitSeconds} onChange={(e) => set("claimWaitSeconds", e.target.value.replace(/\D/g, ""))} />
                    <div className="input-hint">未售罄且超过该时长后，参与者可 claimRefund 全额退款。</div>
                  </div>
                </div>
                <div className="w-grid-2 mt-24">
                  <div>
                    <label className="mono" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--paper-2)" }}>白名单阶段</label>
                    <div className="serif" style={{ color: "var(--paper-3)", fontSize: 14, marginTop: 6 }}>
                      {whitelistEnabled
                        ? `已启用（白名单次数 ${form.whitelistMintCount || 0}）`
                        : "关闭——白名单次数填写大于 0 即自动开启"}
                    </div>
                  </div>
                  <div className="flex center" style={{ justifyContent: "flex-end" }}>
                    <label className="flex center" style={{ gap: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={whitelistEnabled} onChange={(e) => set("whitelistEnabled", e.target.checked)} style={{ width: 16, height: 16, accentColor: "#d4af37" }} />
                      <span className="mono" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--paper-2)" }}>启用白名单阶段</span>
                    </label>
                  </div>
                </div>
                {whitelistEnabled && (
                  <div className="field mt-24">
                    <label>白名单地址（每行一个，部署后自动写入金库）</label>
                    <textarea
                      className="input mono"
                      style={{ minHeight: 120, fontSize: 13 }}
                      placeholder={"0x....\n0x....\n（可填多个，每行一个；留空则后续到详情页设置）"}
                      value={form.whitelistAddresses}
                      onChange={(e) => set("whitelistAddresses", e.target.value)}
                    />
                    <div className="input-hint">
                      {whitelistCount(form.whitelistAddresses) > 0
                        ? `已解析 ${whitelistCount(form.whitelistAddresses)} 个地址（最多 200 个）`
                        : "部署成功后把白名单地址批量写入金库；未填可在项目详情页由创建者补充。"}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-section">
                <h3>接收与分红 / Receiver & Dividend</h3>
                <div className="w-grid-2">
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>接收钱包</label>
                    <input
                      className="input mono"
                      placeholder="0x…（默认=连接钱包）"
                      value={form.receiver}
                      onChange={(e) => set("receiver", e.target.value.trim())}
                    />
                    <div className="input-hint">Fund 资金池税收与结算收入将进入该地址。</div>
                  </div>
                  <div className="field">
                    <label>分红代币地址</label>
                    <input
                      className="input mono"
                      placeholder="默认 USDT"
                      value={form.rewardToken}
                      onChange={(e) => set("rewardToken", e.target.value.trim())}
                    />
                    <div className="input-hint">默认 USDT：{fmtShort(config.defaultRewardToken)}</div>
                  </div>
                  <div className="field">
                    <label>持仓分红门槛（代币数量）</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="0 = 无门槛"
                      value={form.rewardThreshold}
                      onChange={(e) => set("rewardThreshold", e.target.value)}
                    />
                    <div className="input-hint">持币达到该数量才参与自动分红。</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Step 2 ===== */}
          {step === 2 && (
            <>
              <h2 style={{ marginBottom: 6 }}>税费与分红</h2>
              <p className="lede">买卖税、发射保护税与四档分红分配，总分配上限 100%。</p>

              <div className="w-section">
                <h3>交易税 / Trading Tax</h3>
                <div className="w-grid-2">
                  <Range label="买入" value={form.buyTaxBps} onChange={(v) => set("buyTaxBps", v)} />
                  <Range label="卖出" value={form.sellTaxBps} onChange={(v) => set("sellTaxBps", v)} />
                  <Range label="转账" value={form.transferTaxBps} onChange={(v) => set("transferTaxBps", v)} />
                  <Range label="加池" value={form.addLiquidityTaxBps} onChange={(v) => set("addLiquidityTaxBps", v)} />
                  <Range label="撤池" value={form.removeLiquidityTaxBps} onChange={(v) => set("removeLiquidityTaxBps", v)} />
                  <Range label="发射保护" value={form.launchProtectionTaxBps} onChange={(v) => set("launchProtectionTaxBps", v)} />
                </div>
                <div className="field mt-24" style={{ maxWidth: 320 }}>
                  <label>发射保护区块（0 = 关闭）</label>
                  <input className="input" type="number" min={0} value={form.launchProtectionBlocks} onChange={(e) => set("launchProtectionBlocks", e.target.value)} />
                </div>
              </div>

              <div className="w-section">
                <h3>分红分配 / Distribution · Fund 自动 = 100% − LP − 分红 − 燃烧</h3>
                <p className="lede">拖动下方三项，Fund 资金池自动取剩余，四档总和恒为 100%。</p>
                <div className="w-grid-2">
                  <Range label="LP 回流" value={form.lpFeeBps} onChange={(v) => set("lpFeeBps", v)} max={SPLIT_MAX} />
                  <Range label="持有者分红" value={form.dividendFeeBps} onChange={(v) => set("dividendFeeBps", v)} max={SPLIT_MAX} />
                  <Range label="通缩燃烧" value={form.burnFeeBps} onChange={(v) => set("burnFeeBps", v)} max={SPLIT_MAX} />
                </div>
                <div className="flex between center mt-24" style={{ paddingTop: 16, borderTop: "1px solid var(--rule)" }}>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--paper-3)" }}>Fund 资金池（自动）</span>
                  <span className="mono" style={{ fontSize: 22, color: allocationTotal > SPLIT_MAX ? "var(--red)" : "var(--gold-bright)" }}>
                    {(Math.max(0, fundAutoBps) / 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex between center mt-24">
                  <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--paper-3)" }}>LP + 分红 + 燃烧</span>
                  <span className="mono" style={{ fontSize: 14, color: allocationTotal > SPLIT_MAX ? "var(--red)" : "var(--paper)" }}>
                    {(allocationTotal / 100).toFixed(2)}%{allocationTotal > SPLIT_MAX ? " · 超限，请回调" : " · 剩余自动进 Fund"}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* ===== Step 3 ===== */}
          {step === 3 && (
            <>
              <h2 style={{ marginBottom: 6 }}>确认与部署</h2>
              <p className="lede">部署时后端矿机将自动计算 0x…{suffix} 靓号地址，交易确认后自动排队开源验证。</p>

              {!account ? (
                <div className="w-section">
                  <p className="serif" style={{ fontSize: 16, marginBottom: 16 }}>部署前需要连接钱包（{config.nativeSymbol} 主网）。</p>
                  <button className="btn btn-gold" onClick={() => void connect()}>连接钱包 →</button>
                </div>
              ) : (
                <>
                  {chainId !== config.chainId && (
                    <div className="w-section">
                      <p className="mono err-text" style={{ fontSize: 13 }}>⚠ 当前钱包在网络 {chainId} 上，请切换到 {config.nativeSymbol} 主网（Chain {config.chainId}）。</p>
                      <button className="btn btn-sm mt-16" onClick={async () => signer && void (await switchToChain(signer.provider as never).catch(() => {}))}>切换网络</button>
                    </div>
                  )}

                  <div className="w-section">
                    <h3>摘要 / Summary</h3>
                    <div className="dl-list">
                      <div className="dl-row"><span>Name</span><b>{form.name || "—"} ({form.symbol || "—"})</b></div>
                      <div className="dl-row"><span>Concept</span><b>{CONCEPTS.find((c) => c.key === form.conceptKey)?.label}</b></div>
                      <div className="dl-row"><span>Total Supply</span><b className="mono">{form.totalSupply}</b></div>
                      <div className="dl-row"><span>Mintable</span><b className="mono">{totalMintCount.toLocaleString()} 次（公开 {Number(form.publicMintCount) || 0} · 白名单 {Number(form.whitelistMintCount) || 0}）</b></div>
                      <div className="dl-row"><span>Price</span><b className="mono">{form.mintPrice} {config.nativeSymbol}</b></div>
                      <div className="dl-row"><span>Per Mint</span><b className="mono">{perMint.toLocaleString()} 代币</b></div>
                      <div className="dl-row"><span>LP Reserve</span><b className="mono">50% 预留做市</b></div>
                      <div className="dl-row"><span>Refund</span><b className="mono">{Number(form.claimWaitSeconds) > 0 ? `${form.claimWaitSeconds}s 后可退` : "关闭"}</b></div>
                      <div className="dl-row"><span>Receiver</span><b className="mono">{fmtShort(form.receiver || "—")}</b></div>
                      <div className="dl-row"><span>Reward Token</span><b className="mono">{fmtShort(normalizeRewardToken(form.rewardToken))}</b></div>
                      <div className="dl-row"><span>Threshold</span><b className="mono">{Number(form.rewardThreshold) > 0 ? form.rewardThreshold : "无门槛"}</b></div>
                      <div className="dl-row"><span>Avatar</span><b>{form.avatar ? "已上传" : "无"}</b></div>
                      <div className="dl-row"><span>Creation Fee</span><b className="mono">{creationFee} {config.nativeSymbol}</b></div>
                    </div>
                  </div>

                  <div className="w-section">
                    <button
                      className="btn btn-gold btn-block"
                      style={{ paddingBlock: 16, fontSize: 15 }}
                      onClick={() => void handleDeploy()}
                      disabled={deploying || !config.contractsReady || chainId !== config.chainId}
                    >
                      {config.contractsReady
                        ? deploying
                          ? "部署中：挖盐 → 发交易 → 确认回执…"
                          : `确认发射（${creationFee} ${config.nativeSymbol} 创建费）→`
                        : "合约待部署 · 预览模式"}
                    </button>
                    {deploying && (
                      <p className="serif" style={{ color: "var(--gold-bright)", marginTop: 16, fontSize: 14 }}>
                        后端矿机正在计算 0x…{suffix} 靓号地址，并广播 createLaunch 交易……
                      </p>
                    )}
                    {!config.contractsReady && (
                      <p className="serif" style={{ color: "var(--paper-3)", marginTop: 14, fontSize: 13 }}>
                        TVS 专属合约部署后，将自动启用完整发射流程。
                      </p>
                    )}
                  </div>

                  {feeInfo && (
                    <div className="mono" style={{ fontSize: 11, color: "var(--paper-3)", textAlign: "center", marginTop: 32 }}>
                      Factory {config.factoryAddress.slice(0, 8)}… · Deployer {feeInfo.tokenDeployer.slice(0, 10)}…
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* 步骤导航 */}
          <div className="flex between center mt-48" style={{ paddingTop: 24, borderTop: "1px solid var(--rule)" }}>
            <button className="btn" onClick={() => (step > 0 ? setStep(step - 1) : navigate("/"))} disabled={deploying}>
              ← {step === 0 ? "返回首页" : "上一步"}
            </button>
            {step < 3 && <button className="btn btn-gold" onClick={() => goto(step + 1)}>下一步 →</button>}
          </div>
        </div>
      </div>
    </section>
  );
}