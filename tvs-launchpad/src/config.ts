/**
 * 全局配置：TVS（藤昇）发射台 DApp 子站
 *
 * 链上地址与后端地址统一收口在这里。
 * TVS 专属合约已于 BSC 主网部署（kimiMint 发射模板）：
 *   Factory:        0xf0B745dc06C5b69950De5ab4461f777b9FD9fDAa
 *   TokenDeployer:  0xCF0BB26d251A0c2035ce2CB8C1b2972AA0cA0363
 *   VaultDeployer:  0x7C8978f478eC77d2fAf1390268fC161b7deDFcCB
 *   FeeRecipient:   0x25a39709B476B380a75b11521893Db0cbA52b39B（平台税临时收款，后续可换）
 *   RequiredSuffix: 0xa86b ｜ CreationFee: 0.005 BNB
 */
export const config = {
  chainId: 56,
  nativeSymbol: "BNB",
  /** 是否已部署 TVS 专属合约。false = 占位模式，前端禁用发币/铸造动作 */
  contractsReady: true,
  /** TVS 专属 KimiMintLaunchFactory（BSC 主网） */
  factoryAddress: "0xf0B745dc06C5b69950De5ab4461f777b9FD9fDAa",
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