import { homedir } from 'os'
import { join } from 'path'

export type Network = 'mainnet' | 'devnet'

export interface MCPServerConfig {
  storagePath: string
  defaultNetwork: Network
  rpcUrls: {
    mainnet: string
    devnet: string
  }
  maxComputeUnitLimitAtomic: number
  requireIntentCheckForSigning: boolean
}

export const config: MCPServerConfig = {
  storagePath: join(homedir(), '.solana-mcp-wallet'),
  defaultNetwork: 'devnet',
  rpcUrls: {
    mainnet: process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
    devnet: process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com'
  },
  maxComputeUnitLimitAtomic: 1000000,
  requireIntentCheckForSigning: true
}

export function getRpcUrl(network: Network): string {
  return config.rpcUrls[network]
}
