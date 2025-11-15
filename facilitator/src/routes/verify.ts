import { Request, Response } from 'express'
import { VerifyRequest, VerifyResponse, Network } from '../types'
import { SolanaService } from '../services/solanaService'
import { EVMService } from '../services/evmService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')
const evmService = new EVMService()

/**
 * POST /verify
 * Verifies a payment payload against requirements
 */
export const verifyPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const verifyRequest: VerifyRequest = req.body

    // Validate request structure
    if (!verifyRequest.x402Version || !verifyRequest.paymentPayload || !verifyRequest.paymentRequirements) {
      res.status(400).json({
        isValid: false,
        error: 'Invalid request structure'
      } as VerifyResponse)
      return
    }

    // Check x402Version compatibility
    if (verifyRequest.x402Version !== 1) {
      res.status(400).json({
        isValid: false,
        error: 'Unsupported x402Version'
      } as VerifyResponse)
      return
    }

    const { paymentRequirements, paymentPayload } = verifyRequest
    const network: string = paymentRequirements.network

    // Determine chain type
    const isSVM = network === 'solana' || network === 'solana-devnet'
    const isEVM = network === 'base' || network === 'base-sepolia'

    if (!isSVM && !isEVM) {
      res.status(400).json({
        isValid: false,
        error: `Unsupported network: ${network}`
      } as VerifyResponse)
      return
    }

    let isValid = false

    // Route to appropriate service based on network type
    if (isSVM) {
      // Solana payment verification
      switch (network) {
        case 'solana':
          isValid = await solanaMainnetService.verifyPayment(paymentPayload, paymentRequirements)
          break
        case 'solana-devnet':
          isValid = await solanaDevnetService.verifyPayment(paymentPayload, paymentRequirements)
          break
      }
    } else {
      // EVM payment verification
      isValid = await evmService.verifyPaymentWithRequirements(paymentPayload, paymentRequirements)
    }

    const response: VerifyResponse = {
      isValid
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Error in /verify endpoint:', error)
    res.status(500).json({
      isValid: false,
      error: 'Internal server error'
    } as VerifyResponse)
  }
}