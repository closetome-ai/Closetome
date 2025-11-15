import { Request, Response } from 'express'
import { AtomicSettleRequest, AtomicSettleResponse, isEVMAtomicPayload } from '../types'
import { SolanaService } from '../services/solanaService'
import { EVMService } from '../services/evmService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')
const evmService = new EVMService()

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

    const { paymentRequirements, paymentPayload } = settleRequest
    const network = paymentRequirements.network

    // Determine chain type
    const isSVM = network === 'solana' || network === 'solana-devnet'
    const isEVM = network === 'base' || network === 'base-sepolia'

    if (!isSVM && !isEVM) {
      res.status(400).json({
        success: false,
        error: `Unsupported network: ${network}`
      } as AtomicSettleResponse)
      return
    }

    let result: { success: boolean; transactionHash?: string; error?: string }

    // Route to appropriate service based on network type
    if (isSVM) {
      // Solana atomic: validate callback instructions exist
      if (!settleRequest.paymentRequirements.extra?.callbackInstructions) {
        res.status(400).json({
          success: false,
          error: 'No callback instructions provided for atomic transaction'
        } as AtomicSettleResponse)
        return
      }

      switch (network) {
        case 'solana':
          result = await solanaMainnetService.settleAtomicPayment(paymentPayload, paymentRequirements)
          break
        case 'solana-devnet':
          result = await solanaDevnetService.settleAtomicPayment(paymentPayload, paymentRequirements)
          break
        default:
          result = { success: false, error: `Unsupported SVM network: ${network}` }
      }
    } else {
      // EVM atomic: validate and settle payment
      if (!isEVMAtomicPayload(paymentPayload)) {
        res.status(400).json({
          success: false,
          error: 'Invalid EVM atomic payment payload structure'
        } as AtomicSettleResponse)
        return
      }

      result = await evmService.settleAtomicPayment(paymentPayload)
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
