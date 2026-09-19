import { Link } from "react-router-dom";
import { Reveal } from "../components/Reveal";
import { Ticker } from "../components/ui";
import { TendrilHero } from "../components/VineArt";
import { MECHANISMS } from "../lib/concepts";
import { config } from "../config";

const TICKER = [
  "TVS · 一藤多币生态发射协议",
  "原生 RWA 储备 · TENDRIL 数学级只涨不跌",
  "地板价托底 · 双池架构 · 双向涡轮",
  "IWO 永续发行 · FUSE 本金保护",
  "子币在 TVS 上发射，储备在藤蔓里生长",
];

const ARCH = [
  {
    sn: "ROOT · 根",
    name: "TENDRIL",
    desc: "原生 RWA 储备资产，由链上真实资金铸造产生，无预挖、无私募、权限永久丢弃。卖一销二、20% 回流、30% 入金——数学级只涨不跌，为整个生态提供价值根基。",
    chip: "只涨不跌 · 数学保证",
    green: true,
  },
  {
    sn: "TRUNK · 干",
    name: "TVS",
    desc: "生态枢纽与价值网关。所有子币通过 TVS 接入生态，进行储备结算与价值交换。每笔交易 3% 手续费 100% 铸造 TENDRIL 进储备库，自我强化的价值放大中枢。",
    chip: "一藤多币 · 出入网关",
    green: false,
  },
  {
    sn: "BRANCHES · 枝叶",
    name: "子币",
    desc: "基于 TVS 发射协议发行的各类应用代币、社区代币与 Meme。每一个都有 TENDRIL 储备托底，在「干」的营养输送下开枝散叶，反哺生态网络效应。",
    chip: "储备托底 · 网络效应",
    green: false,
  },
];

const FLYWHEEL = [
  { n: "壹", t: "TVS 交易产生 3% 手续费", d: "100% 用于铸造 TENDRIL 进入储备库，直接为 TENDRIL 创造持续买盘。" },
  { n: "贰", t: "TENDRIL 持续上涨", d: "铸造推高 TENDRIL 价格，储备库总价值同步增长。" },
  { n: "叁", t: "TVS 地板价抬升", d: "地板价 = (储备价值 ÷ 流通量) × 70%，储备增值直接抬升地板。" },
  { n: "肆", t: "TVS 上涨 → 更多交易", d: "地板持续抬升吸引更多用户与交易，涡轮自我强化，越转越快。" },
];

const STATS = [
  { val: "10亿", label: "TVS 总供应量" },
  { val: "3%", label: "手续费 · 100% 铸造储备", green: true },
  { val: "70%", label: "地板价储备系数" },
  { val: "15%", label: "季度回购销毁上限" },
];

export default function Home() {
  return (
    <>
      <Ticker items={TICKER} />

      {/* ===== Hero ===== */}
      <section className="hero">
        <div className="container">
          <div className="hero-inner">
            <div>
              <div className="hero-eyebrow hero-anim hero-anim-1">
                <span className="line" />
                <span>TVS · Tendril Vault</span>
                <span>一藤多币 · 发射协议</span>
              </div>
              <h1 className="hero-title hero-anim hero-anim-2">
                藤蔓之上，<br />
                <em className="em-gold">开创未来。</em>
              </h1>
              <p className="hero-lede hero-anim hero-anim-3">
                藤昇（TVS）是藤蔓生态首个枢纽资产：以数学级只涨不跌的原生 RWA 资产
                <em className="em-green"> TENDRIL </em>为底层储备，通过地板价托底、双向涡轮、
                IWO 永续发行与 FUSE 本金保护，构建 DeFi 3.0 的价值发射范式。
              </p>
              <div className="hero-cta hero-anim hero-anim-4">
                <Link to="/launch" className="btn btn-gold btn-lg">发射你的子币 <span className="arr">→</span></Link>
                <Link to="/projects" className="btn btn-green btn-lg">浏览已发射 <span className="arr">→</span></Link>
              </div>
              <div className="hero-stats hero-anim hero-anim-5">
                {STATS.map((s) => (
                  <div className="stat" key={s.label}>
                    <div className="stat-val">{s.val}</div>
                    <div className="stat-label">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hero-art hero-anim hero-anim-3">
              <div className="art-frame">
                <TendrilHero />
                <span className="art-caption">NO. 01 · TENDRIL VAULT</span>
                <span className="art-caption right">MMXXVI · ON-CHAIN</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== §01 一藤多币 ===== */}
      <section className="section">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="kicker">§ 01 · One Vine, Many Coins</span>
              <h2 style={{ marginTop: 18 }}>
                一藤多币，<em className="em-gold">根深则叶茂。</em>
              </h2>
            </div>
          </Reveal>
          <Reveal delay={1}>
            <div className="arch-grid">
              {ARCH.map((a) => (
                <div className="arch-card" key={a.sn}>
                  <span className="arch-sn">{a.sn}</span>
                  <h3>{a.name}</h3>
                  <p>{a.desc}</p>
                  <span className={`arch-chip ${a.green ? "green" : ""}`}>{a.chip}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===== §02 双向涡轮 ===== */}
      <section className="section" style={{ background: "var(--ink-2)" }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="kicker green">§ 02 · Dual Turbine</span>
              <h2 style={{ marginTop: 18 }}>
                双向涡轮，<em className="em-green">越转越快。</em>
              </h2>
              <p className="serif" style={{ color: "var(--paper-2)", fontSize: 15, marginTop: 14, maxWidth: 620, lineHeight: 1.9 }}>
                TVS 交易铸造 TENDRIL 进储备库，储备增值抬升 TVS 地板价，地板价吸引更多交易——四步循环，自我强化，不依赖外部流量输入。
              </p>
            </div>
          </Reveal>
          <div className="stats-band">
            {FLYWHEEL.map((s, i) => (
              <Reveal key={s.n} delay={i % 4} as="div">
                <div className="sb-item">
                  <div className="sb-val">{s.n}</div>
                  <div className="sb-label">{s.t}</div>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mech-index">
            {FLYWHEEL.map((s, i) => (
              <div className="mi-row" key={s.n}>
                <span className="mi-no">STEP 0{i + 1}</span>
                <span className="mi-name">{s.t}</span>
                <span className="mi-desc">{s.d}</span>
                <span className="mi-arrow">→</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== §03 机制索引 ===== */}
      <section className="section">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="kicker">§ 03 · Mechanism Index</span>
              <h2 style={{ marginTop: 18 }}>
                八种机制，<em className="em-gold">写在合约里。</em>
              </h2>
              <p className="serif" style={{ color: "var(--paper-2)", fontSize: 15, marginTop: 14, maxWidth: 620, lineHeight: 1.9 }}>
                不是团队承诺，是代码保证。每个机制对应链上不可升级的智能合约规则。
              </p>
            </div>
          </Reveal>
          <Reveal delay={1}>
            <div className="mech-index">
              {MECHANISMS.map((m, i) => (
                <div className="mi-row" key={m.key}>
                  <span className="mi-no">{String(i + 1).padStart(2, "0")}</span>
                  <span className="mi-name">{m.title}</span>
                  <span className="mi-desc">{m.desc}</span>
                  <span className="mi-arrow">→</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="section" style={{ borderBottom: "none" }}>
        <div className="container">
          <div className="cta-band">
            <Reveal>
              <span className="kicker">§ 04 · The Launch</span>
              <h2 style={{ marginTop: 20 }}>
                根已深植，<em className="em-gold">等你开枝散叶。</em>
              </h2>
              <p>选概念 → 配机制 → 一键发射。你的子币将在藤蔓生态中获得储备托底。</p>
              <div className="flex gap-12" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                <Link to="/launch" className="btn btn-gold btn-lg">立即发射 <span className="arr">→</span></Link>
                <Link to="/projects" className="btn btn-ghost btn-lg">浏览项目 <span className="arr">→</span></Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}