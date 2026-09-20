/** TENDRIL ⇄ TVS 直连互换（直接调用 PancakeSwap V2 Router · 固定路径） */
import { Contract } from "ethers";
import type { Provider, Signer } from "ethers";
import { publicProvider } from "./chain";
import { swapConfig } from "../config";

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function totalSupply() view returns (uint256)",
];

export const ROUTER_ABI = [
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256) returns (uint256,uint256)",
];

export const TVS_STATE_ABI = [
  "function state() view returns (uint8)",
  "function buyTaxRate() view returns (uint16)",
  "function sellTaxRate() view returns (uint16)",
  "function pools(address) view returns (bool)",
];

/** TvsFeeSwap 平台费网关 ABI（swap 时先扣 3% 给 feeRecipient，97% 走 Router 直连池） */
export const FEE_SWAP_ABI = [
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256)",
  "function feeRecipient() view returns (address)",
  "function feeBps() view returns (uint256)",
];

/** 平台通道费率（bp），与合约 feeBps 一致 */
export const PLATFORM_FEE_BPS = 300;

/** 平台费占用量 = amountIn × feeBps / 10000 */
export function feeAmount(input: bigint): bigint {
  return (input * BigInt(PLATFORM_FEE_BPS)) / 10000n;
}

/** TVS 税制状态枚举 */
export const TVS_STATES = ["BondingCurve", "Migrating", "TaxEnforcedAntiFarmer", "TaxEnforced", "TaxFree"];

export function readTendril(provider: Provider = publicProvider) {
  return new Contract(swapConfig.tendril, ERC20_ABI, provider);
}
export function readTvs(provider: Provider = publicProvider) {
  return new Contract(swapConfig.tvs, [...ERC20_ABI, ...TVS_STATE_ABI], provider);
}
export function readPair(provider: Provider = publicProvider) {
  return new Contract(swapConfig.pair, [...ERC20_ABI, ...PAIR_ABI], provider);
}
export function readRouter(provider: Provider = publicProvider) {
  return new Contract(swapConfig.router, ROUTER_ABI, provider);
}

export function pathFor(buy: boolean): string[] {
  return buy ? [swapConfig.tendril, swapConfig.tvs] : [swapConfig.tvs, swapConfig.tendril];
}

/** minOut = out × (1 − slippage%) */
export function applySlippage(out: bigint, slippagePct: number): bigint {
  return out - (out * BigInt(Math.round(slippagePct * 100))) / 10000n;
}

export function deadline20m(): number {
  return Math.floor(Date.now() / 1000) + 60 * 20;
}

export type SignerLike = Signer | null;