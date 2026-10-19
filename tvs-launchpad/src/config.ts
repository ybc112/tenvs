/**
 * 全局配置：TVS（藤昇）发射台 DApp 子站
 *
 * 链上地址与后端地址统一收口在这里。
 * TVS 专属合约已于 BSC 主网部署（kimiMint 发射模板）：
 *   Factory:        0xfBe16d5d3efA0939548ad22D312f35135B7B2507
 *   TokenDeployer:  0x112C85060d44685494542A49fF62D4d8f019B4c0
 *   VaultDeployer:  0xb489A23d84124eBF7CC5963F331E8f338a1726E9
 *   FeeRecipient:   0xc5292218326bb159030664065278e0eba9852e5f（平台税收款地址）
 *   RequiredSuffix: 0xa86b ｜ CreationFee: 0.005 BNB
 */
/**
 * 网络开关：默认主网（线上 Vercel 部署即主网）。
 * 本地测试网联调：tvs-launchpad/.env.development.local 已固定 VITE_NET=testnet，npm run dev 即连测试网。
 * 如需线上站点临时切测试网：在 Vercel 环境变量配置 VITE_NET=testnet 后重新部署（勿改代码默认值）。
 */
const IS_TESTNET = import.meta.env.VITE_NET === "testnet";

export const config = {
  chainId: IS_TESTNET ? 97 : 56,
  nativeSymbol: "BNB",
  /** 发射台合约仅主网就绪；测试网下 /launch 走占位模式 */
  contractsReady: !IS_TESTNET,
  /** TVS 专属 KimiMintLaunchFactory（BSC 主网） */
  factoryAddress: "0xfBe16d5d3efA0939548ad22D312f35135B7B2507",
  rpcUrl: IS_TESTNET
    ? "https://bsc-testnet.publicnode.com"
    : "https://bsc.publicnode.com",
  /** 后端地址。留空 = 同源（dev 走 vite proxy /api；生产走反向代理） */
  backendUrl: "",
  /** 靓号后缀（占位，呼应藤绿 #00a86b；后端以链上 requiredTokenSuffix 为准） */
  vanitySuffix: "a86b",
  /** 本地挖盐最大迭代（默认走后端矿机） */
  vanityMaxIterations: 600000,
  /** 链上精确的 Token creation bytecode（可选，来自服务器 pristine 文件） */
  tokenCreationHex: "",
  /** 默认分红代币（USDT on BSC） */
  defaultRewardToken: "0x55d398326f99059fF775485246999027B3197955",
  /** 占位模式提示文案（仅在 contractsReady=false 时展示） */
  placeholderNote:
    "发射功能尚未完全就绪（合约或后端部署中）。请稍后重试或联系项目方。",
};

export const EXPLORER_BASE =
  config.chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";

/**
 * TENDRIL ⇄ TVS 直连互换（直接调用 PancakeSwap V2 Router，固定路径 [TENDRIL, TVS] / [TVS, TENDRIL]）
 */
export const swapConfig = {
  router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  tendril: "0xb1afdfd850da168f2cc9f742e11cdda5273973d2",
  tvs: "0x221f7336711cd6eb72d8c897a0d185a12a357777",
  pair: "0x73b667a81bd62d266fdb58a593751b56d1c0ecba",
  /** TvsFeeSwap 平台费网关（3% 通道费 → feeRecipient） */
  feeSwap: "0xc7823820230259810fD8cd19a8390DBB430593e8",
  /** 平台费收款钱包（3% 进这里） */
  feeRecipient: "0x21148e8a732aad6a22aaa50db1ef4a61fd8df1be",
  /** 平台通道费率（bp） */
  feeBps: 300,
};

export const fmtAddress = (addr: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";

/**
 * VSA 质押挖矿配置（TVS 质押 → VSA 产出）
 * stakingReady=false 时 /stake 页面显示占位空态，不发任何 RPC 请求
 */
export const stakingConfig = {
  /** 合约是否已部署。false = 占位模式，前端禁用全部质押动作（主网/测试网均已部署 → true） */
  stakingReady: true,
  /** VSAStaking 合约地址 */
  staking: IS_TESTNET
    ? "0x90c14add8ab45146cf09085faaa88dd7d9a1cd5a" // BSC Testnet（2026-10-16 重部署：单钱包无上限、期内不可解除）
    : "0x50d4737E4351158Af874DCC73Bdfdc5D1Ea122F0", // BSC Mainnet（2026-10-18 首版，owner=质押多签；2026-10-19 曾短暂切到重部署版后已切回）
  /** 质押币 TVS（主网与 Swap 同一地址；测试网为 MockTVS 测试币） */
  tvs: IS_TESTNET
    ? "0x60599d3C26ad2e22D984a3Ec43e9e4e930244473" // MockTVS @ BSC Testnet
    : "0x221f7336711cd6eb72d8c897a0d185a12a357777",
  /** 产出币 VSA（外部代币合约） */
  vsa: IS_TESTNET
    ? "0x8D99c642D81c914b1268afF57304CaC7287f19ec" // MockVSA @ BSC Testnet
    : "0x02828c0a371ab1a0f2d2ec446484a06aaaa87777", // VSA @ BSC Mainnet
  /** 10 年总产出（与链上 TOTAL_EMISSION 一致，前端展示用） */
  totalEmission: 10_000_000n * 10n ** 18n,
};

/**
 * 代币分发配置（TGE 锁仓释放 → 各多签角色）
 * distributorReady=false 时 /distribution 页面显示占位空态，不发任何 RPC 请求
 * 测试网（BSC-97）：TokenDistributor 0x7fb0de501ea0d51b99705b95885ebf1ffd616de5（2026-10-13）
 * 主网（BSC-56）：TokenDistributor 0x1425B5e3C86b405364B10ad412D20462e89Dd79B（2026-10-18）
 *   记录见 vsa-staking/deployments/mainnet.json；5 条日程由 owner（金库多签）经 Safe 创建
 */
export const distributorConfig = {
  /** 合约是否已部署。false = 占位模式（主网/测试网均已部署 → true） */
  distributorReady: true,
  /** TokenDistributor 合约地址 */
  distributor: IS_TESTNET
    ? "0x7fb0de501ea0d51b99705b95885ebf1ffd616de5" // BSC Testnet
    : "0x1425B5e3C86b405364B10ad412D20462e89Dd79B", // BSC Mainnet（2026-10-18）
  /** 分发代币地址（主网为 VSA；钱包↔分发合约转账零税，无需税豁免） */
  token: IS_TESTNET
    ? "0x28e1ec018dbc306cd57da27f412b9d4f1b4b6d15" // MockTVS（分发用）@ BSC Testnet
    : "0x02828c0a371ab1A0F2D2EC446484a06AAAa87777", // VSA @ BSC Mainnet
  /** 多签角色（展示用，与链上 beneficiary 对照） */
  roles: [
    { label: "市值多签", address: "0xa80F329Fd36b9c2DA6dEC86d1df1E518500A9123" },
    { label: "LP 多签", address: "0x6e5Ed612Fc7B054c28a3d2C1aC92eeB098EAD7d5" },
    { label: "社区激励多签", address: "0x227ea5869d11cC683BA9B43F8BC10278B210Ff3f" },
    { label: "商学院多签", address: "0x6e5Ed612Fc7B054c28a3d2C1aC92eeB098EAD7d5" },
    { label: "质押多签", address: "0x72f8637eC6519702B99a22Ec6F893FB3822dD213" },
    { label: "社区自治核心（治理）", address: "0xaBce72802F9d85CdB45063057E079ce6AbdD7812" },
  ],
};