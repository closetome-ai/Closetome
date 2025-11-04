import { Request, Response } from 'express'
import { SettleRequest, SettleResponse } from '../types'
import { SolanaService } from '../services/solanaService'
import { BaseService } from '../services/baseService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')
const baseMainnetService = new BaseService('base')
const baseSepoliaService = new BaseService('base-sepolia')

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
    let result: { success: boolean; transactionHash?: string; error?: string }

    // Route to appropriate service based on network
    switch (paymentRequirements.network) {
      case 'solana':
        result = await solanaMainnetService.settlePayment(paymentPayload, paymentRequirements)
        break
      case 'solana-devnet':
        result = await solanaDevnetService.settlePayment(paymentPayload, paymentRequirements)
        break
      case 'base':
        result = await baseMainnetService.settlePayment(paymentPayload, paymentRequirements)
        break
      case 'base-sepolia':
        result = await baseSepoliaService.settlePayment(paymentPayload, paymentRequirements)
        break
      default:
        res.status(400).json({
          success: false,
          error: `Unsupported network: ${paymentRequirements.network}`
        } as SettleResponse)
        return
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