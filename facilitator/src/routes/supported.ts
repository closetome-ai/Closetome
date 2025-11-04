import { Request, Response } from 'express'
import { SUPPORTED_NETWORKS, SupportedPaymentKindsResponse } from '../types'

/**
 * GET /supported
 * Returns the list of supported payment networks
 */
export const getSupportedNetworks = async (req: Request, res: Response): Promise<void> => {
  try {
    // Return only solana and base networks as requested
    const response: SupportedPaymentKindsResponse = {
      kinds: [
        SUPPORTED_NETWORKS['solana-devnet'],
        SUPPORTED_NETWORKS['solana'],
        SUPPORTED_NETWORKS['base-sepolia'],
        SUPPORTED_NETWORKS['base']
      ]
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Error in /supported endpoint:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}