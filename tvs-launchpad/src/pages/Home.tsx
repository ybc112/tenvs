import { Link } from "react-router-dom";
import { Reveal } from "../components/Reveal";

/* ===== 官网内容 ===== */
const HERO_STATS = [
  { val: "10亿", label: "TVS 总供应量" },
  { val: "3%", label: "交易手续费（100%铸造TENDRIL）" },
  { val: "70%", label: "地板价储备系数" },
  { val: "15%", label: "季度回购销毁上限" },
];

const TRINITY = [
  {
    icon: "🏦",
    cls: "green",
    title: "原生RWA",
    desc: "TVS的储备资产TENDRIL不是链下国债或黄金，而是由真实资金铸造产生的「链上原生真实世界资产」。每一枚TENDRIL背后都有真实USDT储备，价值锚定动态生产力，而非静态资产。",
    tags: ["真实资金铸造", "无预挖无私募", "链上完全透明"],
  },
  {
    icon: "⚡",
    cls: "gold",
    title: "DeFi 3.0",
    desc: "第一代DeFi（Uniswap/Aave）解决了可编程金融，但留不住资金；第二代（Olympus/Curve）实现协议自有流动性，但通胀不可持续。TVS代表DeFi 3.0——原生RWA储备+地板价托底+双向涡轮，协议与用户利益完全一致。",
    tags: ["协议自有流动性", "通缩模型", "利益一致"],
  },
  {
    icon: "🚀",
    cls: "mix",
    title: "发射平台代币",
    desc: "Pump.fun/Pons证明了发射平台赛道的巨大潜力，但子币毕业率不足0.8%。TVS将「平台收入驱动」升级为「储备资产驱动」，将「回购销毁」升级为「地板价托底」，让每一个发射的子币都有真实价值支撑。",
    tags: ["IWO永续发行", "FUSE本金保护", "一藤多币"],
  },
];

const FLYWHEEL_STEPS = [
  { t: "TVS交易产生手续费", d: "每笔TVS交易收取3%手续费，100%用于铸造TENDRIL进入储备库，直接为TENDRIL创造持续买盘。" },
  { t: "TENDRIL需求增加→上涨", d: "持续铸造推高TENDRIL价格，储备库总价值同步增长。" },
  { t: "TVS地板价抬升", d: "地板价=(TENDRIL储备价值÷TVS流通量)×70%，储备增值直接抬升地板。" },
  { t: "TVS上涨→更多交易", d: "地板价持续抬升吸引更多用户和交易，涡轮自我强化，越转越快。" },
];

const MECHS = [
  {
    n: "01",
    t: "地板价托底",
    d: "TVS的地板价由TENDRIL储备库托底，公式写死在合约中，无人可篡改。TENDRIL只涨不跌，所以TVS地板价只涨不跌。",
    f: "地板价 = (TENDRIL储备总价值 ÷ TVS流通量) × 70%",
    feats: ["市场价跌破地板价时，套利者自动买入推回", "TENDRIL上涨→储备增值→地板价自动抬升", "不是「承诺」，是「数学」——合约写死，不可更改"],
  },
  {
    n: "02",
    t: "双池架构",
    d: "TVS采用两个独立流动性池协同运行，一个托底，一个发现价格，通过套利者自动平衡。",
    f: "TENDRIL/TVS池（地板） + U/TVS池（天花板）",
    feats: ["TENDRIL/TVS池：锚定地板价，储备托底", "U/TVS池：市场价格发现，外部用户自由买卖", "套利者自动拉平两池价格，不触发母池30%手续费"],
  },
  {
    n: "03",
    t: "IWO + FUSE 投资者保护",
    d: "TVS首创IWO（首次永续发行）模式和FUSE模型，从机制层面保护投资者，避免传统发射平台的「一次性砸盘」和「项目方跑路」风险。",
    f: "IWO锁仓竞价 + NFT份额 + 按秒解锁 + FUSE 1:1赎回",
    feats: ["IWO：用户基于锁仓时间竞价获得份额，份额是可交易NFT，代币按秒解锁", "FUSE：质押稳定币获得CST，项目方未达预期时可1:1赎回本金", "从机制上杜绝「科学家抢跑」和「项目方砸盘」"],
  },
  {
    n: "04",
    t: "退出即建设",
    d: "传统项目中，退出=砸盘=伤害系统。在藤蔓生态中，通过TVS中转退出TENDRIL，手续费从30%降至约3%，且每一次退出都在强化系统。",
    f: "TENDRIL → TVS → U ｜ 手续费 30% → 约3%",
    feats: ["TENDRIL锁入TENDRIL/TVS池 → 地板价抬升", "TVS卖出触发销毁 → 流通量减少 → 稀缺性增加", "每一次「聪明的退出」，都在让系统变得更强大"],
  },
];

const RESERVE_MECHS = [
  { t: "卖一销二", d: "卖出1000枚自动销毁2000枚，流通量双倍通缩" },
  { t: "20%回流底池", d: "卖出手续费20%回流LP底池，卖出即创造买盘" },
  { t: "底池不等式", d: "LP底池U价值始终大于流通代币总价值，数学级兑付" },
  { t: "权限永久丢弃", d: "合约无管理员权限，无人可改规则、挪资金" },
];

const ALLOC = [
  { label: "池子深度", pct: "60%" },
  { label: "USDT分红", pct: "15%" },
  { label: "回购销毁", pct: "10%" },
  { label: "生态发展", pct: "15%" },
];

const TOK_LEGEND = [
  { color: "#d4af37", text: "Flap买断（含私募、LP、团队、营销）", pct: "80%" },
  { color: "#00a86b", text: "生态储备（多签钱包，未流通）", pct: "20%" },
];

const ROADMAP = [
  {
    phase: "Q3 2026 · 已完成",
    cls: "done",
    t: "🌱 TENDRIL 协议启动",
    items: ["藤蔓协议主网上线，原生RWA铸造机制启动", "卖一销二、底池不等式、权限丢弃等核心机制部署", "社区共识建立，持币地址持续增长"],
  },
  {
    phase: "Q3 2026 · 进行中",
    cls: "",
    t: "🚀 TVS 上线与首发",
    items: ["TVS（藤昇）正式上线Uniswap V3，Flap发射平台首发", "双池架构部署，地板价机制启动，双向涡轮开始运转", "IWO首次永续发行模式上线", "社区深度共识会，生态伙伴拓展"],
  },
  {
    phase: "Q4 2026",
    cls: "",
    t: "⚡ FUSE模型与首个子币发射",
    items: ["FUSE本金保护模型上线，质押稳定币获得CST", "藤蔓生态第二个子币发射，验证「一藤多币」模式", "TVS季度回购销毁首次执行", "多链部署评估（BSC/罗宾汉链/以太坊）"],
  },
  {
    phase: "Q1 2027",
    cls: "",
    t: "🌿 生态扩展与多链部署",
    items: ["多链部署完成，TVS跨链桥上线", "发射平台开放，第三方项目可通过TVS生态发射", "平台利润分红机制首次执行", "机构合作与合规框架建立"],
  },
  {
    phase: "Q2 2027+",
    cls: "",
    t: "🏛️ 一藤多币生态成熟",
    items: ["藤蔓生态子币数量达到10+，TVS作为枢纽资产价值凸显", "原生RWA储备规模突破里程碑", "DeFi 3.0标准制定者地位确立", "DAO治理全面启动，社区自治"],
  },
];

export default function Home() {
  return (
    <>
      {/* ===== Hero ===== */}
      <section className="hero">
        <div className="container">
          <div className="hero-content hero-anim hero-anim-1">
            <div className="hero-badge"><span className="dot" /> 原生RWA · DeFi 3.0 · 发射平台 — 三重叙事合一</div>
            <h1 className="hero-anim hero-anim-2">
              以<span className="gold">只涨不跌</span>的TENDRIL为储备<br />打造<span className="green">DeFi 3.0</span>时代的价值发射协议
            </h1>
            <p className="hero-anim hero-anim-3">
              TVS（藤昇）是藤蔓生态首个子币，以数学级只涨不跌的TENDRIL为底层储备资产，通过地板价托底、双向涡轮、IWO投资者保护等创新机制，构建原生RWA与发射平台的价值飞轮。
            </p>
            <div className="hero-cta hero-anim hero-anim-4">
              <Link to="/launch" className="btn btn-gold btn-lg">去发射台</Link>
              <a href="#roadmap" className="btn btn-outline btn-lg">阅读白皮书</a>
            </div>
            <div className="hero-stats hero-anim hero-anim-5">
              {HERO_STATS.map((s) => (
                <div className="stat-card" key={s.label}>
                  <div className="stat-value">{s.val}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <style>{`.hero-content{position:relative;z-index:2;text-align:center;max-width:900px;margin:0 auto}`}</style>
      </section>

      {/* ===== Trinity 三重叙事 ===== */}
      <section className="section trinity" id="about">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <span className="section-tag">Triple Narrative</span>
              <h2 className="section-title">三重重大叙事，一站站稳</h2>
              <p className="section-desc">TVS不是单一赛道的项目，而是原生RWA、DeFi 3.0、发射平台三条赛道的交汇点，每一条叙事都有真实机制支撑。</p>
            </div>
          </Reveal>
          <div className="trinity-grid">
            {TRINITY.map((c, i) => (
              <Reveal key={c.title} delay={i % 3} as="div">
                <div className="trinity-card">
                  <div className={`trinity-icon ${c.cls}`}>{c.icon}</div>
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                  <div className="tag-list">
                    {c.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Value Flywheel 双向涡轮 ===== */}
      <section className="section flywheel">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <span className="section-tag">Value Flywheel</span>
              <h2 className="section-title">TENDRIL × TVS 双向涡轮</h2>
              <p className="section-desc">TENDRIL是「根」，TVS是「干」。根扎得越深，干长得越高；干越繁荣，根越强壮。这不是零和博弈，是互相促进的价值飞轮。</p>
            </div>
          </Reveal>
          <div className="flywheel-visual">
            <Reveal as="div">
              <div className="flywheel-node root">
                <div className="node-icon">🌱</div>
                <h4>TENDRIL</h4>
                <p>底层储备资产<br />只涨不跌的根</p>
              </div>
            </Reveal>
            <div className="flywheel-arrow">
              <span>储备托底</span>↓<span>铸造增值</span>↑
            </div>
            <Reveal as="div">
              <div className="flywheel-node vault">
                <div className="node-icon">🛡️</div>
                <h4>TVS</h4>
                <p>上层发射协议<br />价值放大的干</p>
              </div>
            </Reveal>
          </div>
          <div className="flywheel-steps">
            {FLYWHEEL_STEPS.map((s, i) => (
              <Reveal key={s.t} delay={i % 4} as="div">
                <div className="flywheel-step">
                  <div className="step-num">{i + 1}</div>
                  <h5>{s.t}</h5>
                  <p>{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Core Mechanisms 四大核心机制 ===== */}
      <section className="section" id="mechanism">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <span className="section-tag">Core Mechanisms</span>
              <h2 className="section-title">四大核心机制，构建价值护城河</h2>
              <p className="section-desc">每一个机制都写死在不可升级的智能合约中，不是团队承诺，是代码保证。</p>
            </div>
          </Reveal>
          <div className="mech-grid">
            {MECHS.map((m, i) => (
              <Reveal key={m.n} delay={i % 2} as="div">
                <div className="mech-card">
                  <div className="mech-head">
                    <div className="mech-num">{m.n}</div>
                    <h3>{m.t}</h3>
                  </div>
                  <p>{m.d}</p>
                  <div className="formula">{m.f}</div>
                  <ul className="feature-list">
                    {m.feats.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Reserve Asset 储备资产 ===== */}
      <section className="section reserve" id="reserve">
        <div className="container">
          <div className="reserve-layout">
            <Reveal as="div">
              <div className="reserve-visual">
                <div className="reserve-circle">
                  <div className="reserve-circle-inner">
                    <div className="reserve-center">
                      <div className="rc-icon">🌱</div>
                      <div className="rc-text">TENDRIL</div>
                      <div className="rc-sub">原生RWA储备</div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal as="div">
              <div className="reserve-content">
                <span className="section-tag">Reserve Asset</span>
                <h2>为什么 <span>TENDRIL</span><br />是最强储备资产？</h2>
                <p>TENDRIL不是普通的加密货币，它是一种与真实生产力挂钩的原生RWA。没有预挖、没有私募、没有团队预留，完全通过真实资金铸造产生。每一枚TENDRIL背后都有真实USDT支撑。</p>
                <div className="reserve-mechs">
                  {RESERVE_MECHS.map((m) => (
                    <div className="rm-item" key={m.t}>
                      <h5>{m.t}</h5>
                      <p>{m.d}</p>
                    </div>
                  ))}
                </div>
                <div className="reserve-alloc">
                  <h5>📊 TENDRIL 铸造资金分配</h5>
                  <div className="alloc-bars">
                    {ALLOC.map((a) => (
                      <div className="alloc-bar" key={a.label}>
                        <span className="ab-label">{a.label}</span>
                        <div className="ab-track"><div className="ab-fill" style={{ width: a.pct }} /></div>
                        <span className="ab-pct">{a.pct}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ===== Tokenomics 代币经济 ===== */}
      <section className="section tokenomics" id="tokenomics">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <span className="section-tag">Tokenomics</span>
              <h2 className="section-title">TVS 代币经济学</h2>
              <p className="section-desc">总量10亿枚，通缩模型，持续回购销毁，5%平台利润分配给持有者。</p>
            </div>
          </Reveal>
          <div className="tok-layout">
            <Reveal as="div">
              <div className="tok-visual">
                <div className="tok-ring">
                  <svg viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="24" />
                    <circle cx="100" cy="100" r="80" fill="none" stroke="#d4af37" strokeWidth="24" strokeDasharray="402 502" strokeDashoffset="0" />
                    <circle cx="100" cy="100" r="80" fill="none" stroke="#00a86b" strokeWidth="24" strokeDasharray="100 502" strokeDashoffset="-402" />
                  </svg>
                  <div className="tok-ring-center">
                    <div className="trc-val">10亿</div>
                    <div className="trc-label">TVS TOTAL SUPPLY</div>
                  </div>
                </div>
                <div className="tok-legend">
                  {TOK_LEGEND.map((l) => (
                    <div className="tok-legend-item" key={l.text}>
                      <div className="tli-dot" style={{ background: l.color }} />
                      <span className="tli-text">{l.text}</span>
                      <span className="tli-pct">{l.pct}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal as="div">
              <div className="tok-details">
                <h3>交易税与分配</h3>
                <div className="tok-detail-card">
                  <h4>💰 交易税率</h4>
                  <div className="tax-grid">
                    <div className="tax-item">
                      <div className="ti-val">3%</div>
                      <div className="ti-label">每笔交易手续费</div>
                    </div>
                    <div className="tax-item">
                      <div className="ti-val">100%</div>
                      <div className="ti-label">用于铸造TENDRIL</div>
                    </div>
                  </div>
                </div>
                <div className="tok-detail-card">
                  <h4>📊 税收分配（每笔交易）</h4>
                  <div className="tax-alloc">
                    <div className="tax-alloc-item">
                      <span style={{ width: 140 }}>铸造TENDRIL进储备库</span>
                      <div className="tai-bar"><div className="tai-fill" style={{ width: "100%", background: "linear-gradient(90deg,#d4af37,#f0d78c)" }} /></div>
                      <span className="tai-pct" style={{ color: "#d4af37" }}>100%</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--gray)", marginTop: 14, lineHeight: 1.7 }}>
                    每笔TVS交易收取3%手续费，<strong style={{ color: "var(--gold-l)" }}>100%用于铸造TENDRIL进入储备库</strong>。这意味着TVS的每一次交易都在直接为TENDRIL创造买盘，推动储备增值，进而抬升TVS地板价——双向涡轮的核心燃料。
                  </p>
                </div>
                <div className="tok-detail-card">
                  <h4>🔥 通缩与分红机制</h4>
                  <ul className="feature-list" style={{ margin: 0 }}>
                    <li>季度回购销毁：最高15%的季度收入用于回购销毁TVS</li>
                    <li>平台利润分红：5%的平台利润分配给TVS持有者</li>
                    <li>交易税全量铸造：每笔交易3%手续费100%用于铸造TENDRIL，持续为储备库增值，涡轮自我强化</li>
                    <li>Flap毕业机制：募集达标后自动毕业，剩余代币自动添加流动性并永久锁定</li>
                  </ul>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ===== Roadmap 路线图 ===== */}
      <section className="section roadmap" id="roadmap">
        <div className="container">
          <Reveal>
            <div className="section-header center">
              <span className="section-tag">Roadmap</span>
              <h2 className="section-title">发展路线图</h2>
              <p className="section-desc">从TVS上线到一藤多币生态成熟，每一步都有明确目标。</p>
            </div>
          </Reveal>
          <div className="rm-timeline">
            {ROADMAP.map((r, i) => (
              <Reveal key={r.phase} delay={i % 3} as="div">
                <div className={`rm-item ${r.cls}`}>
                  <div className="rm-phase">{r.phase}</div>
                  <h4>{r.t}</h4>
                  <ul>
                    {r.items.map((it) => <li key={it}>{it}</li>)}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Community 社区 ===== */}
      <section className="community">
        <div className="container">
          <Reveal>
            <h2>加入藤蔓社区</h2>
            <p>与全球社区成员一起，见证原生RWA与DeFi 3.0的未来。藤蔓新生，一起向上。</p>
            <div className="community-links">
              <div className="community-link" title="Twitter/X">𝕏</div>
              <div className="community-link" title="Telegram">✈️</div>
              <div className="community-link" title="Discord">💬</div>
              <div className="community-link" title="Medium">📝</div>
              <div className="community-link" title="GitHub">🐙</div>
            </div>
            <div style={{ marginTop: 40 }}>
              <Link to="/launch" className="btn btn-gold btn-lg">去发射台 →</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}