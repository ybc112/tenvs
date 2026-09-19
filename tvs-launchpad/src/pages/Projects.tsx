import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useProjects } from "../lib/data";
import { CardSkeleton, ProgressBar, StatusBadge, Ticker } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { conceptDisplay } from "../lib/concepts";
import { readVault } from "../lib/chain";
import type { LaunchProject } from "../types";
import { fmtPrice } from "../lib/format";
import { EXPLORER_BASE, config } from "../config";
import { PlaceholderBanner } from "../components/PlaceholderBanner";

const zero = BigInt(0);

/** 复制按钮 */
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
      onClick={(e) => {
        e.preventDefault();
        void copy();
      }}
      className="mono"
      style={{ marginLeft: 8, border: "1px solid var(--rule)", padding: "1px 6px", fontSize: 9, color: copied ? "var(--gold-bright)" : "var(--paper-3)", cursor: "pointer", background: "transparent" }}
      title="复制地址"
    >
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

function ProjectCard({ project }: { project: LaunchProject }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [minted, setMinted] = useState<bigint | null>(null);
  const [finalized, setFinalized] = useState<boolean | null>(null);
  const [refundDeadline, setRefundDeadline] = useState<bigint | null>(null);
  const [wlEnabled, setWlEnabled] = useState(false);
  const [wlMinted, setWlMinted] = useState("—");
  const [pubMinted, setPubMinted] = useState("—");
  const concept = conceptDisplay(project.templateId);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const vault = readVault(project.vault);
        const [finalizedRaw, totalMints, mintedCount, deadline, wlOn, wlMintedRaw, pubMintedRaw] = await Promise.all([
          vault.finalized(),
          vault.totalMints(),
          vault.mintedCount(),
          vault.refundDeadline(),
          vault.whitelistEnabled(),
          vault.whitelistMintedCount().catch(() => 0n),
          vault.publicMintedCount().catch(() => 0n),
        ]);
        if (!mounted) return;
        setFinalized(Boolean(finalizedRaw));
        setMinted(BigInt(mintedCount ?? 0));
        setRefundDeadline(BigInt(deadline ?? 0));
        setWlEnabled(Boolean(wlOn));
        setWlMinted(BigInt(wlMintedRaw ?? 0).toLocaleString() + "/" + project.whitelistMintCount.toLocaleString());
        setPubMinted(BigInt(pubMintedRaw ?? 0).toLocaleString() + "/" + (project.mintCount - project.whitelistMintCount).toLocaleString());
        const total = BigInt(totalMints ?? 1);
        setProgress(total > zero ? Number((BigInt(mintedCount ?? 0) * BigInt(10000)) / total) : 0);
      } catch {
        /* 合约未部署/读取失败 */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [project]);

  const nowSec = Math.floor(Date.now() / 1000);
  const status = finalized
    ? "finalized"
    : refundDeadline && nowSec > Number(refundDeadline) && minted !== null && minted < project.mintCount
      ? "refunding"
      : minted !== null && minted >= project.mintCount
        ? "soldout"
        : "open";

  return (
    <Link to={`/project/${project.address}`} className="project-card">
      <div className="pc-head">
        <span className="pc-no">{project.address.slice(-6).toUpperCase()}</span>
        <StatusBadge status={status} />
      </div>
      <div className="pc-body">
        {project.avatar ? (
          <div className="pc-avatar"><img src={project.avatar} alt="" /></div>
        ) : (
          <div className="pc-avatar">{project.symbol.slice(0, 4) || "TKN"}</div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="pc-name">{project.name || "Unnamed"}</div>
          <div className="pc-symbol">${project.symbol} · {concept.label}</div>
        </div>
      </div>
      {project.description && <p className="pc-desc">{project.description}</p>}
      <ProgressBar value={progress ?? 0} />
      <div className="pc-metrics">
        <div className="pc-row">
          <span>Minted</span>
          <b className="mono">{minted !== null ? `${minted.toLocaleString()} / ${project.mintCount.toLocaleString()}` : "—"}</b>
        </div>
        {wlEnabled && (
          <div className="pc-row">
            <span>白名单 · 公开</span>
            <b className="mono" style={{ fontSize: 11 }}>{wlMinted} · {pubMinted}</b>
          </div>
        )}
        <div className="pc-row">
          <span>Price</span>
          <b className="mono">{fmtPrice(project.mintPrice)} {config.nativeSymbol}</b>
        </div>
      </div>
      <div className="pc-foot">
        <span>0x…{project.address.slice(-4)}<CopyButton text={project.address} /></span>
        <span>
          {finalized && (
            <a
              href={`https://pancakeswap.finance/swap?outputCurrency=${project.address}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ marginRight: 12 }}
            >
              交易 →
            </a>
          )}
          <span>{progress !== null ? `${(progress / 100).toFixed(1)}%` : "…"}</span>
        </span>
      </div>
    </Link>
  );
}

export default function Projects() {
  const { projects, loading, error, total, done, loadMore } = useProjects(9);
  const [keyword, setKeyword] = useState("");

  const filtered = keyword
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(keyword.toLowerCase()) ||
          p.symbol.toLowerCase().includes(keyword.toLowerCase()) ||
          p.address.toLowerCase().includes(keyword.toLowerCase()),
      )
    : projects;

  return (
    <>
      <Ticker items={["The Project Index", `已索引 ${total} 个发射`, "数据源：BSC 公共 RPC", "实时同步链上"]} />
      <section className="container page">
        <PlaceholderBanner />

        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
          <span className="kicker">ISSUE 03</span>
          <span className="serif" style={{ color: "var(--paper-3)", fontSize: 15 }}>项目索引</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 60, alignItems: "end", marginBottom: 44 }}>
          <h1>
            正在上链的<em className="em-gold">藤蔓们</em>
          </h1>
          <p className="serif" style={{ color: "var(--paper-2)", fontSize: 17 }}>
            从 Factory 实时读取，共 {total} 个项目。点击卡片查看详情与铸造。
          </p>
        </div>

        <div className="flex center" style={{ gap: 16, marginBottom: 24, borderBottom: "1px solid var(--rule)", paddingBottom: 16 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--paper-3)", flex: "none" }}>Search</span>
          <input
            className="input"
            placeholder="按名称 / 符号 / 地址过滤"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
            刷新 ↗
          </button>
          <Link to="/launch" className="btn btn-gold">去发射 →</Link>
        </div>

        {error && (
          <div className="err-text" style={{ border: "1px solid var(--red)", padding: 20, marginBottom: 24 }}>
            ⚠ {error}（请确认合约已部署与 BSC RPC 可用，或刷新重试）
          </div>
        )}

        <div className="project-grid">
          {filtered.map((p, i) => (
            <Reveal key={p.address} delay={i % 3}>
              <ProjectCard project={p} />
            </Reveal>
          ))}
          {loading && [0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>

        {!done && !loading && (
          <div style={{ textAlign: "center", marginTop: 48 }}>
            <button className="btn" onClick={() => void loadMore()}>加载更多 <span className="arr">→</span></button>
          </div>
        )}
        {done && projects.length > 0 && (
          <div style={{ textAlign: "center", marginTop: 48, fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--paper-3)", fontSize: 14 }}>
            — 以上就是全部 {projects.length} 个项目 —
          </div>
        )}
        {!loading && !error && projects.length === 0 && (
          <div className="empty-state">
            <div className="es-mark">‡</div>
            <p>还没有任何子币发行。</p>
            <Link to="/launch" className="btn btn-gold">成为第一个发射的人 →</Link>
            <p className="mono" style={{ fontSize: 10, color: "var(--paper-3)", marginTop: 24, letterSpacing: ".06em" }}>链上数据：{EXPLORER_BASE}</p>
          </div>
        )}
      </section>
    </>
  );
}