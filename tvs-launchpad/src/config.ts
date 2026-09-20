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
export const config = {
  chainId: 56,
  nativeSymbol: "BNB",
  /** 是否已部署 TVS 专属合约。false = 占位模式，前端禁用发币/铸造动作 */
  contractsReady: true,
  /** TVS 专属 KimiMintLaunchFactory（BSC 主网） */
  factoryAddress: "0xfBe16d5d3efA0939548ad22D312f35135B7B2507",
  rpcUrl: "https://bsc.publicnode.com",
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

export const fmtAddress = (addr: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";