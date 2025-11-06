import { Request, Response } from 'express'
import { AtomicSettleRequest, AtomicSettleResponse } from '../types'
import { SolanaService } from '../services/solanaService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')

/**
 * POST /atomic/settle
 * Settles an atomic payment with callback instructions
 */
export const settleAtomicPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const settleRequest: AtomicSettleRequest = req.body

    // Validate request structure
    if (!settleRequest.x402Version || !settleRequest.paymentPayload || !settleRequest.paymentRequirements) {
      res.status(400).json({
        success: false,
        error: 'Invalid request structure - missing required fields'
      } as AtomicSettleResponse)
      return
    }

    // Check x402Version compatibility
    if (settleRequest.x402Version !== 1) {
      res.status(400).json({
        success: false,
        error: 'Unsupported x402Version'
      } as AtomicSettleResponse)
      return
    }

    // Validate callback instructions exist
    if (!settleRequest.paymentRequirements.extra?.callbackInstructions) {
      res.status(400).json({
        success: false,
        error: 'No callback instructions provided for atomic transaction'
      } as AtomicSettleResponse)
      return
    }

    const { paymentRequirements, paymentPayload } = settleRequest
    let result: { success: boolean; transactionHash?: string; error?: string }

    // Route to appropriate service based on network
    switch (paymentRequirements.network) {
      case 'solana':
        result = await solanaMainnetService.settleAtomicPayment(paymentPayload, paymentRequirements)
        break
      case 'solana-devnet':
        result = await solanaDevnetService.settleAtomicPayment(paymentPayload, paymentRequirements)
        break
      case 'base':
      case 'base-sepolia':
        res.status(400).json({
          success: false,
          error: 'Atomic transactions not yet supported for EVM networks'
        } as AtomicSettleResponse)
        return
      default:
        res.status(400).json({
          success: false,
          error: `Unsupported network: ${paymentRequirements.network}`
        } as AtomicSettleResponse)
        return
    }

    const response: AtomicSettleResponse = {
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error
    }

    res.status(result.success ? 200 : 400).json(response)
  } catch (error) {
    console.error('Error in /atomic/settle endpoint:', error)
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AtomicSettleResponse)
  }
}
