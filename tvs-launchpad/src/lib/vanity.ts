import { AbiCoder, Contract, Interface, getCreate2Address, isAddress, keccak256, randomBytes, hexlify } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { config } from "../config";
import { publicProvider, readFactory, factoryAbi } from "./chain";
import { postJson, requestVerify } from "./api";
import type { LaunchParams, VanityResult } from "../types";

/** 后端可接受的 params 形态（字符串/数字，符合 normalizeLaunchParams） */
export interface BackendLaunchParams {
  name: string;
  symbol: string;
  metadataUri: string;
  totalSupply: string;
  mintCount: string;
  mintPrice: string;
  maxMintPerWallet: string;
  paymentToken: string;
  rewardToken: string;
  rewardThreshold: string;
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
  whitelistMintCount: string;
  whitelistEnabled: boolean;
}

export function toBackendParams(p: LaunchParams): BackendLaunchParams {
  return {
    name: p.name,
    symbol: p.symbol,
    metadataUri: p.metadataUri,
    totalSupply: p.totalSupply.toString(),
    mintCount: p.mintCount.toString(),
    mintPrice: p.mintPrice.toString(),
    maxMintPerWallet: p.maxMintPerWallet.toString(),
    paymentToken: p.paymentToken,
    rewardToken: p.rewardToken,
    rewardThreshold: p.rewardThreshold.toString(),
    receiver: p.receiver,
    templateId: p.templateId,
    buyTaxBps: p.buyTaxBps,
    sellTaxBps: p.sellTaxBps,
    transferTaxBps: p.transferTaxBps,
    addLiquidityTaxBps: p.addLiquidityTaxBps,
    removeLiquidityTaxBps: p.removeLiquidityTaxBps,
    launchProtectionTaxBps: p.launchProtectionTaxBps,
    launchProtectionBlocks: p.launchProtectionBlocks,
    claimWait: p.claimWait,
    fundFeeBps: p.fundFeeBps,
    lpFeeBps: p.lpFeeBps,
    dividendFeeBps: p.dividendFeeBps,
    burnFeeBps: p.burnFeeBps,
    whitelistMintCount: p.whitelistMintCount.toString(),
    whitelistEnabled: p.whitelistEnabled,
  };
}

/** 后端矿机（链上精确 init code，唯一可靠来源） */
export async function mineByBackend(
  creator: string,
  params: LaunchParams,
  suffix: string,
  maxIterations = config.vanityMaxIterations,
): Promise<VanityResult> {
  const res = await postJson<VanityResult>("/api/vanity-salt", {
    creator,
    suffix,
    params: toBackendParams(params),
    maxIterations,
  });
  if (!res.ok) {
    throw new Error(`后端矿机未能挖到 ${res.suffix} 结尾地址（尝试 ${res.attempts} 次），请降低成功率预期或稍后再试`);
  }
  return res;
}

/**
 * 本地挖盐兜底：仅当 VITE_TOKEN_CREATION_HEX 配置了链上精确 creation bytecode 才可用。
 * 挖盐的 init code = creation bytecode + (LaunchConfig, TaxConfig, factory) 编码。
 */
const LaunchConfigTuple =
  "tuple(string name,string symbol,string projectUri,bytes32 templateId,address receiver,address platformFeeReceiver,address paymentToken,address rewardToken,uint256 rewardThreshold,uint256 totalSupply)";
const TaxConfigTuple =
  "tuple(uint16 buyTaxBps,uint16 sellTaxBps,uint16 transferTaxBps,uint16 addLiquidityTaxBps,uint16 removeLiquidityTaxBps,uint16 launchProtectionTaxBps,uint16 launchProtectionBlocks,uint32 claimWait,uint16 fundFeeBps,uint16 lpFeeBps,uint16 dividendFeeBps,uint16 burnFeeBps)";

export async function mineLocally(
  creator: string,
  params: LaunchParams,
  suffix: string,
  maxIterations = config.vanityMaxIterations,
): Promise<VanityResult> {
  const creationHex = config.tokenCreationHex;
  if (!creationHex.startsWith("0x")) {
    throw new Error("未配置 VITE_TOKEN_CREATION_HEX，无法本地挖盐（请走后端矿机）");
  }

  const factory = readFactory(publicProvider);
  const tokenDeployer = await factory.tokenDeployer();
  const rewardToken =
    params.rewardToken === "0x0000000000000000000000000000000000000000"
      ? config.defaultRewardToken
      : params.rewardToken;
  const [platformFeeReceiver] = await Promise.all([factory.feeRecipient()]);

  const encodedArgs = AbiCoder.defaultAbiCoder().encode(
    [LaunchConfigTuple, TaxConfigTuple, "address"],
    [
      {
        name: params.name,
        symbol: params.symbol,
        projectUri: params.metadataUri,
        templateId: params.templateId,
        receiver: params.receiver,
        platformFeeReceiver,
        paymentToken: params.paymentToken,
        rewardToken,
        rewardThreshold: params.rewardThreshold,
        totalSupply: params.totalSupply,
      },
      {
        buyTaxBps: params.buyTaxBps,
        sellTaxBps: params.sellTaxBps,
        transferTaxBps: params.transferTaxBps,
        addLiquidityTaxBps: params.addLiquidityTaxBps,
        removeLiquidityTaxBps: params.removeLiquidityTaxBps,
        launchProtectionTaxBps: params.launchProtectionTaxBps,
        launchProtectionBlocks: params.launchProtectionBlocks,
        claimWait: params.claimWait,
        fundFeeBps: params.fundFeeBps,
        lpFeeBps: params.lpFeeBps,
        dividendFeeBps: params.dividendFeeBps,
        burnFeeBps: params.burnFeeBps,
      },
      config.factoryAddress,
    ],
  );

  const initCodeHash = keccak256(`${creationHex}${encodedArgs.slice(2)}`);
  const startedAt = Date.now();
  const suffixLower = suffix.replace(/^0x/i, "").toLowerCase();

  for (let attempts = 1; attempts <= maxIterations; attempts += 1) {
    const salt = hexlify(randomBytes(32));
    const tokenSalt = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32", "string", "string", "uint256"],
        [creator, salt, params.name, params.symbol, config.chainId],
      ),
    );
    const tokenAddress = getCreate2Address(tokenDeployer, tokenSalt, initCodeHash);
    if (tokenAddress.toLowerCase().endsWith(suffixLower)) {
      return {
        ok: true,
        suffix: suffixLower,
        salt,
        tokenSalt,
        tokenAddress,
        factory: config.factoryAddress,
        chainId: config.chainId,
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    suffix: suffixLower,
    factory: config.factoryAddress,
    chainId: config.chainId,
    attempts: maxIterations,
    elapsedMs: Date.now() - startedAt,
  };
}

/** 推荐挖盐入口：后端优先，配置了本地 bytecode 则本地兜底 */
export async function mineVanitySalt(
  creator: string,
  params: LaunchParams,
  suffix: string,
): Promise<VanityResult> {
  if (config.tokenCreationHex) {
    try {
      return await mineLocally(creator, params, suffix);
    } catch (err) {
      console.warn("[vanity] 本地挖盐失败，回退后端矿机:", err);
    }
  }
  return mineByBackend(creator, params, suffix);
}

/** 从交易回执解析 LaunchCreated 事件中的代币地址与金库地址 */
export function readLaunchCreated(
  receipt: { logs?: Array<{ address?: string; data: string; topics: string[] }> } | null | undefined,
): { token: string; vault: string } {
  if (!receipt?.logs?.length) return { token: "", vault: "" };
  const iface = new Interface(factoryAbi);
  for (const log of receipt.logs) {
    if (log.address && log.address.toLowerCase() !== config.factoryAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ data: log.data, topics: log.topics });
      if (parsed?.name === "LaunchCreated") {
        return {
          token: isAddress(String(parsed.args.token)) ? String(parsed.args.token) : "",
          vault: isAddress(String(parsed.args.vault)) ? String(parsed.args.vault) : "",
        };
      }
    } catch {
      /* 非 Factory 日志 */
    }
  }
  return { token: "", vault: "" };
}

export interface DeployResult {
  hash: string;
  salt: string;
  tokenAddress: string;
  vaultAddress: string;
  predictedTokenAddress: string;
  vanitySuffix: string;
  vanityAttempts: number;
}

/**
 * 一步到位发射（对齐 KimiMint 前端逻辑）：
 * 1. 后端矿机挖 0x…{suffix} 靓号 salt（并校验 factory/chainId/suffix）
 * 2. 用返回的 salt 调 factory.createLaunch 发交易
 * 3. 等回执并解析 LaunchCreated 事件拿到代币地址
 * 4. 自动排队后端开源验证
 */
export async function deployMintLaunch(
  signer: JsonRpcSigner,
  params: LaunchParams,
  suffix: string,
  creationFeeWei: bigint,
): Promise<DeployResult> {
  const account = await signer.getAddress();
  const vanity = await mineVanitySalt(account, params, suffix);
  if (!vanity.ok || !vanity.salt) {
    throw new Error(`未能匹配到 0x…${vanity.suffix} 结尾的靓号地址（尝试 ${vanity.attempts} 次），请稍后再试`);
  }

  const factory = new Contract(config.factoryAddress, factoryAbi, signer);
  const tx = await factory.createLaunch(params, vanity.salt, { value: creationFeeWei });
  const receipt = await tx.wait();

  const { token: tokenAddress, vault: vaultAddress } = readLaunchCreated(receipt as never);
  if (!tokenAddress) {
    throw new Error("交易已上链，但未能在回执中解析出代币地址，请在区块浏览器确认");
  }

  // 自动排队后端开源验证（失败不阻塞部署流程）
  void requestVerify(tokenAddress).catch(() => {});

  return {
    hash: tx.hash,
    salt: vanity.salt,
    tokenAddress,
    vaultAddress,
    predictedTokenAddress: vanity.tokenAddress || "",
    vanitySuffix: vanity.suffix,
    vanityAttempts: vanity.attempts,
  };
}