import "viem/window";
import { createWalletClient, custom, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { walletTypedData } from "./approval";
import type { ApprovalPayload } from "./types";

export interface WalletState {
  address: Address;
  chainId: number;
}

function client() {
  if (!window.ethereum) throw new Error("브라우저 지갑을 찾지 못했습니다.");
  return createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
}

export async function connectWallet(): Promise<WalletState> {
  const wallet = client();
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error("지갑 계정을 선택해 주세요.");
  return { address, chainId: await wallet.getChainId() };
}

export async function currentWallet(): Promise<WalletState | null> {
  if (!window.ethereum) return null;
  const wallet = client();
  const [address] = await wallet.getAddresses();
  return address ? { address, chainId: await wallet.getChainId() } : null;
}

/** Switches to Base Sepolia; adds the network first when the wallet doesn't know it (EIP-1193 error 4902). */
export async function switchToBaseSepolia(): Promise<WalletState | null> {
  const wallet = client();
  try {
    await wallet.switchChain({ id: baseSepolia.id });
  } catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code
      ?? (error as { cause?: { code?: number } }).cause?.code;
    if (code !== 4902) throw error;
    await wallet.addChain({ chain: baseSepolia });
    await wallet.switchChain({ id: baseSepolia.id });
  }
  return currentWallet();
}

export async function signApproval(payload: ApprovalPayload, account: Address) {
  const wallet = client();
  const [current] = await wallet.getAddresses();
  if (!current || current.toLowerCase() !== account.toLowerCase()) {
    throw new Error("서명 직전에 지갑 계정이 바뀌었습니다.");
  }
  if (await wallet.getChainId() !== baseSepolia.id) {
    throw new Error("서명 직전에 네트워크가 바뀌었습니다.");
  }
  return wallet.signTypedData({ account, ...walletTypedData(payload) });
}

export function watchWallet(onChange: () => void): () => void {
  const provider = window.ethereum as (typeof window.ethereum & {
    on?: (event: string, listener: () => void) => void;
    removeListener?: (event: string, listener: () => void) => void;
  }) | undefined;
  provider?.on?.("accountsChanged", onChange);
  provider?.on?.("chainChanged", onChange);
  return () => {
    provider?.removeListener?.("accountsChanged", onChange);
    provider?.removeListener?.("chainChanged", onChange);
  };
}
