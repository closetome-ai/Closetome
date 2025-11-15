import { Request, Response } from 'express'
import { SUPPORTED_NETWORKS, SupportedPaymentKindsResponse } from '../types'
import { SolanaService } from '../services/solanaService'
import { EVMService } from '../services/evmService'

/**
 * GET /supported
 * Returns the list of supported payment networks
 */
export const getSupportedNetworks = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get fee payer and compute budget config from Solana services
    const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
    const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')

    const feePayerMainnet = solanaMainnetService.getFeePayerPublicKey()
    const feePayerDevnet = solanaDevnetService.getFeePayerPublicKey()

    // Get compute budget config (same for both networks)
    const computeBudgetConfig = solanaMainnetService.getComputeBudgetConfig()

    // Build supported networks with dynamic fee payer and compute budget config
    const networks = []

    // Solana Devnet
    const solanaDevnet = { ...SUPPORTED_NETWORKS['solana-devnet'] }
    solanaDevnet.extra = {
      ...solanaDevnet.extra,
      ...(feePayerDevnet && { feePayer: feePayerDevnet }),
      ...(computeBudgetConfig.unitPrice > 0 && { computeUnitPrice: computeBudgetConfig.unitPrice }),
      ...(computeBudgetConfig.unitLimit > 0 && { computeUnitLimit: computeBudgetConfig.unitLimit }),
      ...(computeBudgetConfig.maxUnitLimitAtomic > 0 && { maxComputeUnitLimitAtomic: computeBudgetConfig.maxUnitLimitAtomic })
    }
    networks.push(solanaDevnet)

    // Solana Mainnet
    const solanaMainnet = { ...SUPPORTED_NETWORKS['solana'] }
    solanaMainnet.extra = {
      ...solanaMainnet.extra,
      ...(feePayerMainnet && { feePayer: feePayerMainnet }),
      ...(computeBudgetConfig.unitPrice > 0 && { computeUnitPrice: computeBudgetConfig.unitPrice }),
      ...(computeBudgetConfig.unitLimit > 0 && { computeUnitLimit: computeBudgetConfig.unitLimit }),
      ...(computeBudgetConfig.maxUnitLimitAtomic > 0 && { maxComputeUnitLimitAtomic: computeBudgetConfig.maxUnitLimitAtomic })
    }
    networks.push(solanaMainnet)

    // Base networks - add proxy contract info if configured
    const evmService = new EVMService()

    const baseSepolia = { ...SUPPORTED_NETWORKS['base-sepolia'] }
    try {
      const proxyContract = evmService.getProxyContract('base-sepolia')
      baseSepolia.extra = { proxyContract }
    } catch {
      // No proxy contract configured for base-sepolia
    }
    networks.push(baseSepolia)

    const base = { ...SUPPORTED_NETWORKS['base'] }
    try {
      const proxyContract = evmService.getProxyContract('base')
      base.extra = { proxyContract }
    } catch {
      // No proxy contract configured for base mainnet
    }
    networks.push(base)

    const response: SupportedPaymentKindsResponse = {
      kinds: networks
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Error in /supported endpoint:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}