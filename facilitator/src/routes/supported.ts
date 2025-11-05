import { Request, Response } from 'express'
import { SUPPORTED_NETWORKS, SupportedPaymentKindsResponse } from '../types'
import { SolanaService } from '../services/solanaService'

/**
 * GET /supported
 * Returns the list of supported payment networks
 */
export const getSupportedNetworks = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get fee payer from Solana services
    const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
    const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')

    const feePayerMainnet = solanaMainnetService.getFeePayerPublicKey()
    const feePayerDevnet = solanaDevnetService.getFeePayerPublicKey()

    // Build supported networks with dynamic fee payer
    const networks = []

    // Solana Devnet
    const solanaDevnet = { ...SUPPORTED_NETWORKS['solana-devnet'] }
    if (feePayerDevnet) {
      solanaDevnet.extra = { ...solanaDevnet.extra, feePayer: feePayerDevnet }
    }
    networks.push(solanaDevnet)

    // Solana Mainnet
    const solanaMainnet = { ...SUPPORTED_NETWORKS['solana'] }
    if (feePayerMainnet) {
      solanaMainnet.extra = { ...solanaMainnet.extra, feePayer: feePayerMainnet }
    }
    networks.push(solanaMainnet)

    // Base networks (no fee payer needed)
    networks.push(SUPPORTED_NETWORKS['base-sepolia'])
    networks.push(SUPPORTED_NETWORKS['base'])

    const response: SupportedPaymentKindsResponse = {
      kinds: networks
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Error in /supported endpoint:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}