/**
 * 全局配置：TVS（藤昇）发射台 DApp 子站
 *
 * 链上地址与后端地址统一收口在这里。
 * 当前为「占位模式」：TVS 专属智能合约尚未部署（白皮书规划的 Flap/IWO 体系开发中），
 * 结构与 KimiMint 发射工厂模板对齐，部署后替换地址并把 contractsReady 置为 true 即全站启用。
 */
export const config = {
  chainId: 56,
  nativeSymbol: "BNB",
  /** 是否已部署 TVS 专属合约。false = 占位模式，前端展示占位提示并禁用发币/铸造动作 */
  contractsReady: false,
  /**
   * TVS 专属 KimiMintLaunchFactory（占位地址，0x…a86b 呼应藤绿）。
   * TODO: 部署后替换为真实工厂地址。
   */
  factoryAddress: "0x000000000000000000000000000000000000a86b",
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
  /** 占位模式提示文案 */
  placeholderNote:
    "TVS 专属合约尚未部署，当前为占位模式。合约部署完成后将自动启用发射、铸造与列表功能。",
};

export const EXPLORER_BASE =
  config.chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";

export const fmtAddress = (addr: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";