import { useCallback, useEffect, useState } from "react";
import { stakingConfig } from "../config";
import { readStaking } from "./chain";

/** 质押档位（与链上 termInfo 一致） */
export const TERMS = [
  { idx: 0, days: 30, mult: 1, label: "30 天", weightLabel: "1.0×" },
  { idx: 1, days: 90, mult: 1.5, label: "90 天", weightLabel: "1.5×" },
  { idx: 2, days: 270, mult: 2.5, label: "270 天", weightLabel: "2.5×" },
] as const;

export interface StakingStats {
  totalWeight: bigint;
  totalStakedTvs: bigint;
  totalStakedVsa: bigint;
  rewardPool: bigint;
  bonusPool: bigint;
  poolSurplus: bigint;
  emitted: bigint;
  dayIndex: number;
  dailyEmission: bigint;
  startTime: number;
  daySeconds: number;
}

export interface StakeRecordView {
  id: number;
  principal: bigint;
  weight: bigint;
  termIdx: number;
  startTime: number;
  maturityTime: number;
  /** true = 复投产生的 VSA 本金质押 */
  isVsa: boolean;
  active: boolean;
}

export interface MyStaking {
  weighted: bigint;
  claimable: bigint;
  /** 被 20% 上限暂存的产出（份额回落后自动补发，不没收） */
  deferred: bigint;
  lockEntries: number;
  pendingRaw: bigint;
  claimableNow: bigint;
  lockedTotal: bigint;
  lockedReleased: bigint;
  stakes: StakeRecordView[];
}

/** 合约是否可用于读取（占位模式下不打任何 RPC） */
export const stakingReady = () => stakingConfig.stakingReady && !!stakingConfig.staking;

const EMPTY_MY: MyStaking = {
  weighted: 0n,
  claimable: 0n,
  deferred: 0n,
  lockEntries: 0,
  pendingRaw: 0n,
  claimableNow: 0n,
  lockedTotal: 0n,
  lockedReleased: 0n,
  stakes: [],
};

type C = NonNullable<ReturnType<typeof readStaking>>;

/** 全网统计（默认 30s 轮询；失败保留旧值，避免数字闪烁归零） */
export function useStakingStats(pollMs = 30_000) {
  const [stats, setStats] = useState<StakingStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!stakingReady()) return;
    const c = readStaking();
    if (!c) return;
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const [
        totalWeight,
        totalStakedTvs,
        totalStakedVsa,
        rewardPool,
        bonusPool,
        poolSurplus,
        dayIndex,
        dailyEmission,
        startTime,
        daySeconds,
        emitted,
      ] = await Promise.all([
        c.totalWeight() as Promise<bigint>,
        c.totalStakedTvs() as Promise<bigint>,
        c.totalStakedVsa() as Promise<bigint>,
        c.rewardPool() as Promise<bigint>,
        c.bonusPool() as Promise<bigint>,
        c.poolSurplus() as Promise<bigint>,
        c.dayIndex() as Promise<bigint>,
        c.currentDailyEmission() as Promise<bigint>,
        c.startTime() as Promise<bigint>,
        c.daySeconds() as Promise<bigint>,
        c.emissionAt(now) as Promise<bigint>,
      ]);
      setStats({
        totalWeight,
        totalStakedTvs,
        totalStakedVsa,
        rewardPool,
        bonusPool,
        poolSurplus,
        emitted,
        dayIndex: Number(dayIndex),
        dailyEmission,
        startTime: Number(startTime),
        daySeconds: Number(daySeconds),
      });
    } catch {
      /* 失败保留旧值 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!stakingReady()) return;
    void load();
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { stats, loading, refresh: load };
}

/** 我的质押（账户级账本 + 逐笔记录；默认 30s 轮询，失败保留旧值） */
export function useMyStaking(account: string | null, pollMs = 30_000) {
  const [mine, setMine] = useState<MyStaking>(EMPTY_MY);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!stakingReady() || !account) return;
    const c = readStaking();
    if (!c) return;
    setLoading(true);
    try {
      const [u, p, ls] = await Promise.all([
        c.userInfo(account) as Promise<[bigint, bigint, bigint, bigint[]]>,
        c.pendingOf(account) as Promise<[bigint, bigint, bigint, bigint]>,
        c.lockStats(account) as Promise<[bigint, bigint, bigint]>,
      ]);
      const ids = Array.from(u[3] ?? []).map((x) => Number(x));
      const recs = await Promise.all(ids.map((id) => c.records(id) as Promise<unknown>));
      const stakes: StakeRecordView[] = recs.map((raw, i) => {
        const r = raw as Record<string, unknown>;
        return {
          id: ids[i],
          principal: BigInt(String(r.principal ?? 0)),
          weight: BigInt(String(r.weight ?? 0)),
          termIdx: Number(r.termIdx ?? 0),
          startTime: Number(r.startTime ?? 0),
          maturityTime: Number(r.maturityTime ?? 0),
          isVsa: Boolean(r.isVsa),
          active: Boolean(r.active),
        };
      });
      setMine({
        weighted: u[0],
        claimable: u[1],
        deferred: u[2],
        lockEntries: Number(ls[0] ?? 0),
        pendingRaw: p[0],
        claimableNow: p[1],
        lockedTotal: p[2],
        lockedReleased: p[3],
        stakes,
      });
    } catch {
      /* 失败保留旧值 */
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (!stakingReady() || !account) {
      setMine(EMPTY_MY);
      return;
    }
    void load();
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, account, pollMs]);

  return { mine, loading, refresh: load };
}

export type { C as StakingContract };
