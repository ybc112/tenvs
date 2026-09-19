import { useCallback, useEffect, useRef, useState } from "react";
import type { LaunchProject, VaultStats } from "../types";
import { readFactory, readToken, readVault } from "./chain";
import { conceptOf } from "./concepts";
import { config } from "../config";

const zero = BigInt(0);

/** 解析链上 metadataUri（TVS 发射模板约定：可直接 JSON.parse 的对象，含 avatar/description/website/telegram/x） */
export function parseMetadata(metadataUri: string): {
  description: string;
  avatar: string;
  website: string;
  telegram: string;
  xLink: string;
} {
  const uri = String(metadataUri ?? "").trim();
  if (!uri) return { description: "", avatar: "", website: "", telegram: "", xLink: "" };
  try {
    const parsed = JSON.parse(uri) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      return {
        description: String(parsed.description || ""),
        avatar: String(parsed.avatar || ""),
        website: String(parsed.website || ""),
        telegram: String(parsed.telegram || ""),
        xLink: String(parsed.x || parsed.xLink || ""),
      };
    }
  } catch {
    /* 非 JSON：视为纯 URL（兼容旧数据） */
  }
  return { description: "", avatar: uri, website: "", telegram: "", xLink: "" };
}

/** 解析 factory.getProject 返回的嵌套结构为扁平对象 */
export function parseProject(raw: unknown, address: string): LaunchProject {
  const r = raw as Record<string, unknown>;
  const get = (k: string): unknown => r[k];
  const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v ?? ""));
  const metadataUri = String(get("metadataUri") ?? "");
  const meta = parseMetadata(metadataUri);
  return {
    address,
    name: String(get("name") ?? ""),
    symbol: String(get("symbol") ?? ""),
    creator: String(get("creator") ?? ""),
    vault: String(get("vault") ?? ""),
    templateId: String(get("templateId") ?? ""),
    totalSupply: BigInt(str(get("totalSupply")) || "0"),
    mintCount: BigInt(str(get("mintCount")) || "0"),
    mintPrice: BigInt(str(get("mintPrice")) || "0"),
    maxMintPerWallet: BigInt(str(get("maxMintPerWallet")) || "0"),
    whitelistEnabled: Boolean(get("whitelistEnabled")),
    whitelistMintCount: BigInt(str(get("whitelistMintCount")) || "0"),
    metadataUri,
    description: meta.description,
    avatar: meta.avatar,
    website: meta.website,
    telegram: meta.telegram,
    xLink: meta.xLink,
    rewardToken: String(get("rewardToken") ?? ""),
    rewardThreshold: BigInt(str(get("rewardThreshold")) || "0"),
    createdAt: BigInt(str(get("createdAt")) || "0"),
    buyTaxBps: Number(get("buyTaxBps") || 0),
    sellTaxBps: Number(get("sellTaxBps") || 0),
    transferTaxBps: Number(get("transferTaxBps") || 0),
    addLiquidityTaxBps: Number(get("addLiquidityTaxBps") || 0),
    removeLiquidityTaxBps: Number(get("removeLiquidityTaxBps") || 0),
    launchProtectionTaxBps: Number(get("launchProtectionTaxBps") || 0),
    launchProtectionBlocks: Number(get("launchProtectionBlocks") || 0),
    claimWait: Number(get("claimWait") || 0),
    fundFeeBps: Number(get("fundFeeBps") || 0),
    lpFeeBps: Number(get("lpFeeBps") || 0),
    dividendFeeBps: Number(get("dividendFeeBps") || 0),
    burnFeeBps: Number(get("burnFeeBps") || 0),
  };
}

/** 读取金库运行状态 */
export async function fetchVaultStats(
  vaultAddress: string,
  account?: string | null,
): Promise<VaultStats> {
  const vault = readVault(vaultAddress);
  const resolved = await Promise.all([
    vault.finalized(),
    vault.whitelistEnabled(),
    vault.mintedCount(),
    vault.totalMints(),
    vault.whitelistMintedCount(),
    vault.publicMintedCount(),
    vault.mintPrice(),
    vault.maxMintPerWallet(),
    vault.tokensPerMint(),
    vault.liquidityTokenReserve(),
    vault.refundDeadline(),
  ]);
  const [
    finalized,
    whitelistEnabled,
    mintedCount,
    totalMints,
    whitelistMintedCount,
    publicMintedCount,
    mintPrice,
    maxMintPerWallet,
    tokensPerMint,
    liquidityTokenReserve,
    refundDeadline,
  ] = resolved;

  let mintedByWallet = zero;
  let whitelisted = false;
  if (account) {
    const [a, b] = await Promise.all([
      vault.mintedByWallet(account),
      vault.whitelistList(account).catch(() => false),
    ]);
    mintedByWallet = BigInt(String(a ?? 0));
    whitelisted = Boolean(b);
  }

  return {
    finalized: Boolean(finalized),
    whitelistEnabled: Boolean(whitelistEnabled),
    mintedCount: BigInt(mintedCount ?? 0),
    totalMints: BigInt(totalMints ?? 0),
    whitelistMintedCount: BigInt(whitelistMintedCount ?? 0),
    publicMintedCount: BigInt(publicMintedCount ?? 0),
    mintPrice: BigInt(mintPrice ?? 0),
    maxMintPerWallet: BigInt(maxMintPerWallet ?? 0),
    tokensPerMint: BigInt(tokensPerMint ?? 0),
    liquidityTokenReserve: BigInt(liquidityTokenReserve ?? 0),
    refundDeadline: BigInt(refundDeadline ?? 0),
    mintedByWallet,
    whitelisted,
    progressBps:
      totalMints > zero ? Number(((mintedCount ?? 0) * BigInt(10000)) / totalMints) : 0,
  };
}

/** 项目列表：分页读取 factory 发行记录 */
export function useProjects(pageSize = 9) {
  const [projects, setProjects] = useState<LaunchProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    // 占位模式（合约未部署）：不打 RPC，直接结束加载
    if (!config.contractsReady) {
      setDone(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const f = readFactory();
      const length = Number(await f.allTokensLength());
      setTotal(length);
      if (cursor >= length) {
        setDone(true);
        setLoading(false);
        return;
      }
      const items = await f.getProjects(cursor, pageSize);
      const rawList: Array<Record<string, unknown>> = Array.isArray(items) ? items : [];
      const addresses: string[] = [];
      for (let i = cursor; i < Math.min(cursor + pageSize, length); i += 1) {
        addresses.push(String(await f.allTokens(i)));
      }
      const parsed: LaunchProject[] = rawList.map((item, i) =>
        parseProject(item, addresses[i] || ""),
      );
      // 列表页统一回读链上代币 name/symbol（工厂 getProject 不返回名称字段）
      await Promise.all(
        parsed.map(async (p) => {
          if (p.name) return;
          try {
            const t = readToken(p.address);
            const [n, s] = await Promise.all([t.name(), t.symbol()]);
            p.name = String(n || "");
            p.symbol = String(s || "");
          } catch {
            /* 忽略 */
          }
        }),
      );
      setProjects((prev) => {
        const seen = new Set(prev.map((p) => p.address.toLowerCase()));
        return [...prev, ...parsed.filter((p) => seen.has(p.address.toLowerCase()) === false)];
      });
      setCursor((c) => {
        const next = c + pageSize;
        if (next >= length) setDone(true);
        return Math.min(next, length);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [cursor, done, loading, pageSize]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { projects, loading, error, total, done, loadMore };
}

/** 单个项目的链上详情 + 金库状态（定时刷新） */
export function useProjectDetail(address: string, account?: string | null) {
  const [project, setProject] = useState<LaunchProject | null>(null);
  const [vault, setVault] = useState<VaultStats | null>(null);
  const [pair, setPair] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    // 占位模式：不拉链上数据，由页面渲染占位空态
    if (!config.contractsReady) {
      setProject(null);
      setVault(null);
      setLoading(false);
      return;
    }
    try {
      const f = readFactory();
      const raw = await f.getProject(address);
      const p = parseProject(raw, address);
      // 合约 getProject 的 name/symbol 为空时，回读代币合约补齐（列表页展示用）
      if (!p.name) {
        try {
          const t = readToken(address);
          p.name = String(await t.name());
          p.symbol = String(await t.symbol());
        } catch {
          /* 忽略 */
        }
      }
      setProject(p);
      if (p.vault) {
        const [stat, pairAddr] = await Promise.all([
          fetchVaultStats(p.vault, account),
          readVault(p.vault).liquidityPair(),
        ]);
        setVault(stat);
        setPair(String(pairAddr || ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取项目失败");
    } finally {
      setLoading(false);
    }
  }, [address, account]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const t = setInterval(() => void refresh(), 8_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { project, vault, pair, loading, error, refresh };
}

export const conceptLabel = (tid: string) =>
  conceptOf(tid)?.label ?? `${tid.slice(0, 10)}…`;