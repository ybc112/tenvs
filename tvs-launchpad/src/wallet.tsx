import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { config } from "./config";
import { switchToChain } from "./lib/chain";

interface WalletState {
  account: string | null;
  chainId: number | null;
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState>({
  account: null,
  chainId: null,
  provider: null,
  signer: null,
  connecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
});

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    const eth = window.ethereum;
    if (!eth) {
      setError("未检测到钱包。请安装 MetaMask 或其他以太坊钱包，并切到 BNB Smart Chain。");
      return;
    }
    setConnecting(true);
    try {
      const p = new BrowserProvider(eth as never);
      await switchToChain(p);
      const accounts = await p.send("eth_requestAccounts", []);
      const signerInstance = await p.getSigner();
      const net = await p.getNetwork();
      setProvider(p);
      setSigner(signerInstance);
      setAccount(String(accounts[0]).toLowerCase());
      setChainId(Number(net.chainId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接钱包失败");
    } finally {
      setConnecting(false);
    }
  }, []);

  // 账号切换 / 链切换监听
  useEffect(() => {
    const eth = window.ethereum as
      | { on?: (event: string, cb: (...args: unknown[]) => void) => void; removeListener?: (event: string, cb: (...args: unknown[]) => void) => void }
      | undefined;
    if (!eth?.on) return;

    const onAccounts = async (accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      if (list.length === 0) {
        setAccount(null);
        setSigner(null);
        return;
      }
      setAccount(list[0].toLowerCase());
      try {
        const p = provider || new BrowserProvider(eth as never);
        setSigner(await p.getSigner());
      } catch {
        /* 忽略 */
      }
    };
    const onChain = () => {
      setSigner(null);
      setProvider(null);
      setChainId(null);
      setAccount(null);
      void connect();
    };

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [connect, provider]);

  const disconnect = useCallback(() => {
    setAccount(null);
    setSigner(null);
    setProvider(null);
    setChainId(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ account, chainId, provider, signer, connecting, error, connect, disconnect }),
    [account, chainId, provider, signer, connecting, error, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);
export const targetChainId = config.chainId;