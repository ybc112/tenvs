/** 与链上 Factory 一致的发币参数（对应 createLaunch 的 LaunchParams struct） */
export interface LaunchParams {
  name: string;
  symbol: string;
  metadataUri: string;
  totalSupply: bigint;
  mintCount: bigint;
  mintPrice: bigint;
  maxMintPerWallet: bigint;
  paymentToken: string;
  rewardToken: string;
  rewardThreshold: bigint;
  receiver: string;
  templateId: string;
  buyTaxBps: number;
  sellTaxBps: number;
  transferTaxBps: number;
  addLiquidityTaxBps: number;
  removeLiquidityTaxBps: number;
  launchProtectionTaxBps: number;
  launchProtectionBlocks: number;
  claimWait: number;
  fundFeeBps: number;
  lpFeeBps: number;
  dividendFeeBps: number;
  burnFeeBps: number;
  whitelistMintCount: bigint;
  whitelistEnabled: boolean;
}

/** 后端挖盐请求/返回 */
export interface VanityResult {
  ok: boolean;
  suffix: string;
  salt?: string;
  tokenSalt?: string;
  tokenAddress?: string;
  factory?: string;
  chainId?: number;
  attempts: number;
  elapsedMs?: number;
  error?: string;
}

export type LaunchStatus = "open" | "soldout" | "refunding" | "finalized" | "unknown";

export interface LaunchProject {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  vault: string;
  templateId: string;
  totalSupply: bigint;
  mintCount: bigint;
  mintPrice: bigint;
  maxMintPerWallet: bigint;
  whitelistEnabled: boolean;
  whitelistMintCount: bigint;
  metadataUri: string;
  /** 链上 metadata JSON 解析字段（TVS 发射模板约定） */
  description: string;
  avatar: string;
  website: string;
  telegram: string;
  xLink: string;
  rewardToken: string;
  rewardThreshold: bigint;
  createdAt: bigint;
  mintedCount?: bigint;
  refundDeadline?: bigint;
  finalized?: boolean;
  canRefund?: boolean;
  /** 税费配置 */
  buyTaxBps: number;
  sellTaxBps: number;
  transferTaxBps: number;
  addLiquidityTaxBps: number;
  removeLiquidityTaxBps: number;
  launchProtectionTaxBps: number;
  launchProtectionBlocks: number;
  claimWait: number;
  fundFeeBps: number;
  lpFeeBps: number;
  dividendFeeBps: number;
  burnFeeBps: number;
}

export interface VaultStats {
  finalized: boolean;
  whitelistEnabled: boolean;
  mintedCount: bigint;
  totalMints: bigint;
  whitelistMintedCount: bigint;
  publicMintedCount: bigint;
  mintPrice: bigint;
  maxMintPerWallet: bigint;
  tokensPerMint: bigint;
  liquidityTokenReserve: bigint;
  refundDeadline: bigint;
  mintedByWallet: bigint;
  whitelisted: boolean;
  progressBps: number;
}