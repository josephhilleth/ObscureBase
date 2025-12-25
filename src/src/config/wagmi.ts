import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'ObscureBase Vault',
  projectId: 'c4a9b8a0fa254f5b8b0c9a31c1c4d512',
  chains: [sepolia],
  ssr: false,
});
