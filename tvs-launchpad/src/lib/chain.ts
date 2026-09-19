import { JsonRpcProvider, BrowserProvider, Contract, ZeroAddress, getAddress, isAddress } from "ethers";
import { config } from "../config";
import factoryAbiJson from "../contracts/factory.json";
import vaultAbiJson from "../contracts/vault.json";
import tokenAbiJson from "../contracts/token.json";

export const factoryAbi = factoryAbiJson.abi as never[];
export const vaultAbi = vaultAbiJson.abi as never[];
export const tokenAbi = tokenAbiJson.abi as never[];

/** 只读公共 RPC（未连接钱包时用） */
export const publicProvider = new JsonRpcProvider(config.rpcUrl, config.chainId);

export const readFactory = (provider = publicProvider) =>
  new Contract(config.factoryAddress, factoryAbi, provider);
export const readVault = (vaultAddress: string, provider = publicProvider) =>
  new Contract(vaultAddress, vaultAbi, provider);
export const readToken = (tokenAddress: string, provider = publicProvider) =>
  new Contract(tokenAddress, tokenAbi, provider);

/** 请求钱包切换到目标链 */
export async function switchToChain(provider: BrowserProvider) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) === config.chainId) return;

  const p = provider.provider as unknown as {
    request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
  if (!p?.request) throw new Error("当前钱包不支持切换网络");

  try {
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + config.chainId.toString(16) }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x" + config.chainId.toString(16),
            chainName: config.chainId === 56 ? "BNB Smart Chain" : "BSC Testnet",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [
              config.chainId === 56
                ? "https://bscscan.com"
                : "https://testnet.bscscan.com",
            ],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export const nativeAddress = ZeroAddress;
export const isZeroAddress = (a: string) => getAddress(a) === ZeroAddress;
export const validAddress = (a: string) => isAddress(a) ? getAddress(a) : "";