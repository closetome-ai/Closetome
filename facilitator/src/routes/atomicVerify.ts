import { Request, Response } from 'express'
import { AtomicVerifyRequest, AtomicVerifyResponse, isEVMAtomicPayload } from '../types'
import { SolanaService } from '../services/solanaService'
import { EVMService } from '../services/evmService'

// Initialize services
const solanaMainnetService = new SolanaService('https://api.mainnet-beta.solana.com')
const solanaDevnetService = new SolanaService('https://api.devnet.solana.com')
const evmService = new EVMService()

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

    const { paymentRequirements, paymentPayload } = verifyRequest
    const network = paymentRequirements.network

    // Determine chain type
    const isSVM = network === 'solana' || network === 'solana-devnet'
    const isEVM = network === 'base' || network === 'base-sepolia'

    if (!isSVM && !isEVM) {
      res.status(400).json({
        isValid: false,
        error: `Unsupported network: ${network}`
      } as AtomicVerifyResponse)
      return
    }

    let verifyResult: { isValid: boolean; error?: string; feeAmount?: string }

    // Route to appropriate service based on network type
    if (isSVM) {
      // Solana atomic: validate callback instructions exist
      if (!paymentRequirements.extra?.callbackInstructions) {
        res.status(400).json({
          isValid: false,
          error: 'No callback instructions provided for atomic transaction'
        } as AtomicVerifyResponse)
        return
      }

      let isValid = false
      switch (network) {
        case 'solana':
          isValid = await solanaMainnetService.verifyAtomicPayment(paymentPayload, paymentRequirements)
          break
        case 'solana-devnet':
          isValid = await solanaDevnetService.verifyAtomicPayment(paymentPayload, paymentRequirements)
          break
      }
      verifyResult = { isValid }
    } else {
      // EVM atomic: validate and verify payment payload
      if (!isEVMAtomicPayload(paymentPayload)) {
        res.status(400).json({
          isValid: false,
          error: 'Invalid EVM atomic payment payload structure'
        } as AtomicVerifyResponse)
        return
      }

      verifyResult = await evmService.verifyAtomicPayment(paymentPayload)
    }

    const response: AtomicVerifyResponse = {
      isValid: verifyResult.isValid,
      error: verifyResult.error
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
