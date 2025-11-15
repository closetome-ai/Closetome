import { Request, Response } from 'express'
import { SettleRequest, SettleResponse } from '../types'
import { SolanaService } from '../services/solanaService'
import { EVMService } from '../services/evmService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')
const evmService = new EVMService()

/**
 * POST /settle
 * Settles (submits) a payment to the blockchain
 */
export const settlePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const settleRequest: SettleRequest = req.body

    // Validate request structure
    if (!settleRequest.x402Version || !settleRequest.paymentPayload || !settleRequest.paymentRequirements) {
      res.status(400).json({
        success: false,
        error: 'Invalid request structure'
      } as SettleResponse)
      return
    }

    // Check x402Version compatibility
    if (settleRequest.x402Version !== 1) {
      res.status(400).json({
        success: false,
        error: 'Unsupported x402Version'
      } as SettleResponse)
      return
    }

    const { paymentRequirements, paymentPayload } = settleRequest
    const network: string = paymentRequirements.network

    // Determine chain type
    const isSVM = network === 'solana' || network === 'solana-devnet'
    const isEVM = network === 'base' || network === 'base-sepolia'

    if (!isSVM && !isEVM) {
      res.status(400).json({
        success: false,
        error: `Unsupported network: ${network}`
      } as SettleResponse)
      return
    }

    let result: { success: boolean; transactionHash?: string; error?: string }

    // Route to appropriate service based on network type
    if (isSVM) {
      // Solana payment settlement
      switch (network) {
        case 'solana':
          result = await solanaMainnetService.settlePayment(paymentPayload, paymentRequirements)
          break
        case 'solana-devnet':
          result = await solanaDevnetService.settlePayment(paymentPayload, paymentRequirements)
          break
        default:
          result = { success: false, error: `Unsupported SVM network: ${network}` }
      }
    } else {
      // EVM payment settlement
      result = await evmService.settlePaymentWithRequirements(paymentPayload, paymentRequirements)
    }

    const response: SettleResponse = {
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error
    }

    res.status(result.success ? 200 : 400).json(response)
  } catch (error) {
    console.error('Error in /settle endpoint:', error)
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as SettleResponse)
  }
}