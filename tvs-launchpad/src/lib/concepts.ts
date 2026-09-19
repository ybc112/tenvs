import { id } from "ethers";

/** 多概念预设：映射到链上 templateId = keccak256(key) */
export interface Concept {
  key: string;
  label: string;
  emoji: string;
  tagline: string;
  desc: string;
  accent: string;
}

/** TVS「一藤多币」生态概念：子币通过 TVS 发射协议进入藤蔓生态 */
export const CONCEPTS: Concept[] = [
  {
    key: "tvs-rwa",
    label: "RWA·原生储备",
    emoji: "🏛️",
    tagline: "以链上真实资金为锚",
    desc: "对标 TENDRIL 原生 RWA 范式，储备资产由真实资金铸造，价值锚定动态生产力。",
    accent: "#00a86b",
  },
  {
    key: "tvs-branch",
    label: "生态·枝叶",
    emoji: "🌿",
    tagline: "藤蔓生态子币",
    desc: "作为藤蔓生态的枝叶，通过 TVS 网关接入储备结算，共享网络效应。",
    accent: "#d4af37",
  },
  {
    key: "tvs-defi",
    label: "DEFI·收益",
    emoji: "💎",
    tagline: "持币自动分红",
    desc: "链上自动分红金库，手续费按比例回流持有者，越持越多。",
    accent: "#f0d78c",
  },
  {
    key: "tvs-game",
    label: "GAME·闯关",
    emoji: "🎮",
    tagline: "玩进去，领出来",
    desc: "关卡制机制：通过关卡解锁奖励，让持有者边玩边赚。",
    accent: "#32c88c",
  },
  {
    key: "tvs-social",
    label: "SOCIAL·社交",
    emoji: "🥂",
    tagline: "话题即资产",
    desc: "社区话题与名人效应驱动，把流量变成链上资产。",
    accent: "#a08228",
  },
  {
    key: "tvs-nft",
    label: "NFT·收藏",
    emoji: "🎟️",
    tagline: "代币与藏品绑定",
    desc: "代币 + NFT Collection 一起发，买入送卡牌/门票，收藏与投机两开花。",
    accent: "#4cbf7f",
  },
  {
    key: "tvs-burn",
    label: "BURN·通缩",
    emoji: "🔥",
    tagline: "越烧越值钱",
    desc: "交易与转账燃烧机制，供给端持续抽水，通缩叙事永不过时。",
    accent: "#d4af37",
  },
  {
    key: "tvs-dao",
    label: "DAO·治理",
    emoji: "🏛️",
    tagline: "共识即权力",
    desc: "社区治理模板，子币治理权分发给持有者，共建共享。",
    accent: "#00a86b",
  },
];

export function conceptOf(templateId: string): Concept | null {
  return CONCEPTS.find((c) => id(c.key) === templateId) || null;
}

export function conceptDisplay(templateId: string): { label: string; emoji: string; accent: string } {
  const c = conceptOf(templateId);
  if (c) return { label: c.label, emoji: c.emoji, accent: c.accent };
  return { label: `${templateId.slice(0, 8)}…`, emoji: "🌿", accent: "#00a86b" };
}

/** TVS 多机制清单（发射台 UI 与首页展示复用） */
export const MECHANISMS = [
  { key: "floor", emoji: "🛡️", title: "地板价托底", desc: "储备库公式化托底，价格下限只涨不跌" },
  { key: "dual-pool", emoji: "⚖️", title: "双池架构", desc: "一池托底、一池发现价格，套利自动平衡" },
  { key: "turbine", emoji: "🌀", title: "双向涡轮", desc: "TVS 交易铸造 TENDRIL，涡轮自我强化" },
  { key: "exit-build", emoji: "♻️", title: "退出即建设", desc: "聪明退出反哺系统，出口也是入口" },
  { key: "iwo", emoji: "⏳", title: "IWO 永续发行", desc: "锁仓竞价 + NFT 份额 + 按秒解锁" },
  { key: "fuse", emoji: "🛟", title: "FUSE 本金保护", desc: "质押稳定币，未达预期 1:1 赎回" },
  { key: "flap", emoji: "📈", title: "Flap 联合曲线", desc: "募集达标毕业，LP 永久锁定，毕业即上线" },
  { key: "vanity", emoji: "👑", title: "靓号铸造", desc: "合约地址结尾定制，链上一眼认出" },
];