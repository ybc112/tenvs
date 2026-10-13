import { useCallback, useEffect, useState } from "react";
import { distributorConfig } from "../config";
import { readDistributor } from "./chain";

/** 分发合约是否可用于读取（占位模式下不打任何 RPC） */
export const distributorReady = () =>
  distributorConfig.distributorReady && !!distributorConfig.distributor;

export interface ScheduleView {
  id: number;
  token: string;
  beneficiary: string;
  /** 多签角色标签（对照 distributorConfig.roles，未匹配为空串） */
  roleLabel: string;
  total: bigint;
  released: bigint;
  /** 当前已解锁量（含已领取） */
  vested: bigint;
  start: number;
  cliff: number;
  linearDuration: number;
  tgeBps: number;
  revocable: boolean;
  revoked: boolean;
}

const EMPTY: ScheduleView[] = [];

/** 全部日程 + owner（默认 30s 轮询；失败保留旧值，避免数字闪烁归零） */
export function useDistributorSchedules(pollMs = 30_000) {
  const [schedules, setSchedules] = useState<ScheduleView[]>(EMPTY);
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!distributorReady()) return;
    const c = readDistributor();
    if (!c) return;
    setLoading(true);
    try {
      const [count, ownerAddr] = await Promise.all([
        c.scheduleCount() as Promise<bigint>,
        c.owner() as Promise<string>,
      ]);
      setOwner(ownerAddr);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const n = Number(count);
      const roleOf = (addr: string) =>
        distributorConfig.roles.find((r) => r.address.toLowerCase() === addr.toLowerCase())?.label ?? "";
      const list = await Promise.all(
        Array.from({ length: n }, (_, i) => i).map(async (i) => {
          const s = (await c.schedules(i)) as unknown as Record<string, unknown>;
          const vested = (await c.vested(i, now)) as bigint;
          return {
            id: i,
            token: String(s.token),
            beneficiary: String(s.beneficiary),
            roleLabel: roleOf(String(s.beneficiary)),
            total: BigInt(String(s.total)),
            released: BigInt(String(s.released)),
            vested,
            start: Number(s.start),
            cliff: Number(s.cliff),
            linearDuration: Number(s.linearDuration),
            tgeBps: Number(s.tgeBps),
            revocable: Boolean(s.revocable),
            revoked: Boolean(s.revoked),
          };
        })
      );
      setSchedules(list);
    } catch {
      /* 失败保留旧值 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!distributorReady()) return;
    void load();
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { schedules, owner, loading, refresh: load };
}
