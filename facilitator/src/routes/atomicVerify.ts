import { Request, Response } from 'express'
import { AtomicVerifyRequest, AtomicVerifyResponse } from '../types'
import { SolanaService } from '../services/solanaService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')

/**
 * POST /atomic/verify
 * Verifies an atomic payment with callback instructions
 */
export const verifyAtomicPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const verifyRequest: AtomicVerifyRequest = req.body

    // Validate request structure
    if (!verifyRequest.x402Version || !verifyRequest.paymentPayload || !verifyRequest.paymentRequirements) {
      res.status(400).json({
        isValid: false,
        error: 'Invalid request structure - missing required fields'
      } as AtomicVerifyResponse)
      return
    }

    // Check x402Version compatibility
    if (verifyRequest.x402Version !== 1) {
      res.status(400).json({
        isValid: false,
        error: 'Unsupported x402Version'
      } as AtomicVerifyResponse)
      return
    }

    // Validate callback instructions exist
    if (!verifyRequest.paymentRequirements.extra?.callbackInstructions) {
      res.status(400).json({
        isValid: false,
        error: 'No callback instructions provided for atomic transaction'
      } as AtomicVerifyResponse)
      return
    }

    const { paymentRequirements, paymentPayload } = verifyRequest
    let isValid = false

    // Route to appropriate service based on network
    switch (paymentRequirements.network) {
      case 'solana':
        isValid = await solanaMainnetService.verifyAtomicPayment(paymentPayload, paymentRequirements)
        break
      case 'solana-devnet':
        isValid = await solanaDevnetService.verifyAtomicPayment(paymentPayload, paymentRequirements)
        break
      case 'base':
      case 'base-sepolia':
        res.status(400).json({
          isValid: false,
          error: 'Atomic transactions not yet supported for EVM networks'
        } as AtomicVerifyResponse)
        return
      default:
        res.status(400).json({
          isValid: false,
          error: `Unsupported network: ${paymentRequirements.network}`
        } as AtomicVerifyResponse)
        return
    }

    const response: AtomicVerifyResponse = {
      isValid
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Error in /atomic/verify endpoint:', error)
    res.status(500).json({
      isValid: false,
      error: 'Internal server error'
    } as AtomicVerifyResponse)
  }
}
