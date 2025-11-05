import { ethers } from 'ethers'
import {
  PaymentRequirements,
  PaymentPayload,
  ExactEvmPayload,
  isEvmPayload,
  EvmAddressRegex,
  EvmSignatureRegex,
  HexEncoded64ByteRegex
} from '../types'

export class BaseService {
  private provider: ethers.JsonRpcProvider

  constructor(network: 'base' | 'base-sepolia') {
    const rpcUrl = network === 'base'
      ? 'https://mainnet.base.org'
      : 'https://sepolia.base.org'

    this.provider = new ethers.JsonRpcProvider(rpcUrl)
  }

  /**
   * Verify a Base (Ethereum L2) payment using EIP-3009 Transfer with Authorization
   */
  async verifyPayment(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<boolean> {
    try {
      // Verify basic requirements match
      if (requirements.network !== 'base' && requirements.network !== 'base-sepolia') {
        return false
      }

      // Check if this is an EVM payload
      if (!isEvmPayload(paymentPayload)) {
        console.error('Invalid payment payload: not an EVM transaction')
        return false
      }

      const evmPayload = paymentPayload as ExactEvmPayload

      // Validate signature format
      if (!evmPayload.signature || !EvmSignatureRegex.test(evmPayload.signature)) {
        console.error('Invalid signature format')
        return false
      }

      // Validate authorization structure
      const auth = evmPayload.authorization
      if (!auth || !auth.from || !auth.to || !auth.value ||
          !auth.validAfter || !auth.validBefore || !auth.nonce) {
        console.error('Invalid authorization structure')
        return false
      }

      // Validate addresses
      if (!EvmAddressRegex.test(auth.from) || !EvmAddressRegex.test(auth.to)) {
        console.error('Invalid EVM addresses')
        return false
      }

      // Validate nonce format
      if (!HexEncoded64ByteRegex.test(auth.nonce)) {
        console.error('Invalid nonce format')
        return false
      }

      // Validate timestamps
      const now = Math.floor(Date.now() / 1000)
      const validAfter = parseInt(auth.validAfter)
      const validBefore = parseInt(auth.validBefore)

      if (now < validAfter) {
        console.error('Transfer not yet valid')
        return false
      }

      if (now > validBefore) {
        console.error('Transfer expired')
        return false
      }

      // Check recipient if specified in requirements
      if (requirements.payTo && auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
        console.error('Recipient mismatch')
        return false
      }

      // Check amount if specified in requirements
      if (requirements.maxAmountRequired) {
        const txValue = BigInt(auth.value)
        const requiredAmount = BigInt(requirements.maxAmountRequired)
        if (txValue < requiredAmount) {
          console.error('Insufficient amount')
          return false
        }
      }

      // TODO: Verify signature against authorization (requires EIP-3009 contract interaction)

      return true
    } catch (error) {
      console.error('Error verifying Base payment:', error)
      return false
    }
  }

  /**
   * Settle a Base payment using EIP-3009 Transfer with Authorization
   */
  async settlePayment(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Check if this is an EVM payload
      if (!isEvmPayload(paymentPayload)) {
        return { success: false, error: 'Invalid payment payload: not an EVM transaction' }
      }

      const evmPayload = paymentPayload as ExactEvmPayload

      // For EIP-3009, we need to call the transferWithAuthorization function on the token contract
      // This is a simplified implementation - in production, you would:
      // 1. Get the token contract address (e.g., USDC)
      // 2. Create a contract instance
      // 3. Call transferWithAuthorization with the authorization and signature

      // Example implementation (would need actual contract interaction):
      /*
      const tokenContract = new ethers.Contract(tokenAddress, EIP3009_ABI, signer)
      const tx = await tokenContract.transferWithAuthorization(
        evmPayload.authorization.from,
        evmPayload.authorization.to,
        evmPayload.authorization.value,
        evmPayload.authorization.validAfter,
        evmPayload.authorization.validBefore,
        evmPayload.authorization.nonce,
        evmPayload.signature
      )
      const receipt = await tx.wait()
      */

      // For now, return a placeholder response
      // In production, this would submit the actual EIP-3009 transaction
      return {
        success: false,
        error: 'EIP-3009 settlement not yet implemented - requires token contract interaction'
      }
    } catch (error) {
      console.error('Error settling Base payment:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }
}