import { ethers } from 'ethers'
import evmProxyABI from '../evmProxy.json'
import { PaymentPayload, PaymentRequirements, isEvmPayload, ExactEvmPayload } from '../types'

/**
 * EVM Service for X402 Atomic Payments
 * Handles EVM chain operations including proxy contract interaction
 */

// Proxy contract addresses for different networks
const PROXY_CONTRACTS: Record<string, string> = {
  'base': process.env.BASE_PROXY_CONTRACT || '',
  'base-sepolia': process.env.BASE_SEPOLIA_PROXY_CONTRACT || '0x162BfA7f28aD62D94306d3458D9D53863d6B1d3E'
}

// RPC URLs
const RPC_URLS: Record<string, string> = {
  'base': process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  'base-sepolia': process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
}

// USDC contract addresses
const USDC_ADDRESSES: Record<string, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
}

// Chain IDs
const CHAIN_IDS: Record<string, number> = {
  'base': 8453,
  'base-sepolia': 84532
}

// EIP-712 Domain names for USDC contracts on different networks
// Testnet USDC contracts often use "USDC" while mainnet uses "USD Coin"
const USDC_DOMAIN_NAMES: Record<string, string> = {
  'base': 'USD Coin',           // Mainnet official USDC
  'base-sepolia': 'USDC'        // Testnet USDC
}

// EIP-712 Domain versions for USDC contracts
const USDC_DOMAIN_VERSIONS: Record<string, string> = {
  'base': '2',
  'base-sepolia': '2'
}

export interface EVMPayAuth {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
  v: number
  r: string
  s: string
}

export interface EVMAtomicPaymentPayload {
  userPay: EVMPayAuth
  feePay: EVMPayAuth
  target: string
  callback: string
  proxyContract: string
  network: string
}

export class EVMService {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map()
  private facilitatorWallet?: ethers.Wallet

  constructor() {
    // Load facilitator private key for signing transactions
    const privateKey = process.env.EVM_FACILITATOR_PRIVATE_KEY
    if (privateKey) {
      this.facilitatorWallet = new ethers.Wallet(privateKey)
      console.log('[EVM Service] Facilitator wallet loaded:', this.facilitatorWallet.address)
    } else {
      console.warn('[EVM Service] No facilitator private key configured')
    }
  }

  /**
   * Get provider for a specific network
   */
  private getProvider(network: string): ethers.JsonRpcProvider {
    if (!this.providers.has(network)) {
      const rpcUrl = RPC_URLS[network]
      if (!rpcUrl) {
        throw new Error(`No RPC URL configured for network: ${network}`)
      }
      this.providers.set(network, new ethers.JsonRpcProvider(rpcUrl))
    }
    return this.providers.get(network)!
  }

  /**
   * Get proxy contract address for network
   */
  getProxyContract(network: string): string {
    const address = PROXY_CONTRACTS[network]
    if (!address) {
      throw new Error(`No proxy contract configured for network: ${network}`)
    }
    return address
  }

  /**
   * Get USDC contract address for network
   */
  private getUSDCAddress(network: string): string {
    const address = USDC_ADDRESSES[network]
    if (!address) {
      throw new Error(`No USDC address configured for network: ${network}`)
    }
    return address
  }

  /**
   * Get chain ID for network
   */
  private getChainId(network: string): number {
    const chainId = CHAIN_IDS[network]
    if (!chainId) {
      throw new Error(`No chain ID configured for network: ${network}`)
    }
    return chainId
  }

  /**
   * Verify EIP-3009 transferWithAuthorization signature
   */
  private async verifyTransferWithAuthorization(
    payAuth: EVMPayAuth,
    network: string
  ): Promise<{ isValid: boolean; error?: string; recoveredAddress?: string }> {
    try {
      const usdcAddress = this.getUSDCAddress(network)
      const chainId = this.getChainId(network)

      // EIP-712 domain for USDC
      // Use network-specific domain name (testnets often use different names)
      const domain = {
        name: USDC_DOMAIN_NAMES[network] || 'USD Coin',
        version: USDC_DOMAIN_VERSIONS[network] || '2',
        chainId,
        verifyingContract: usdcAddress
      }

      // EIP-712 types
      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' }
        ]
      }

      // Message to sign
      const message = {
        from: payAuth.from,
        to: payAuth.to,
        value: payAuth.value,
        validAfter: payAuth.validAfter,
        validBefore: payAuth.validBefore,
        nonce: payAuth.nonce
      }

      // Reconstruct signature from v, r, s
      const signature = ethers.Signature.from({
        v: payAuth.v,
        r: payAuth.r,
        s: payAuth.s
      }).serialized

      // Recover signer address
      const digest = ethers.TypedDataEncoder.hash(domain, types, message)
      const recoveredAddress = ethers.recoverAddress(digest, signature)

      // Verify that recovered address matches 'from' address
      if (recoveredAddress.toLowerCase() !== payAuth.from.toLowerCase()) {
        return {
          isValid: false,
          error: `Signature verification failed: recovered ${recoveredAddress}, expected ${payAuth.from}`,
          recoveredAddress
        }
      }

      // Validate time window
      const now = Math.floor(Date.now() / 1000)
      const validAfter = parseInt(payAuth.validAfter)
      const validBefore = parseInt(payAuth.validBefore)

      if (now < validAfter) {
        return {
          isValid: false,
          error: `Authorization not yet valid (validAfter: ${validAfter}, now: ${now})`
        }
      }

      if (now > validBefore) {
        return {
          isValid: false,
          error: `Authorization expired (validBefore: ${validBefore}, now: ${now})`
        }
      }

      return { isValid: true, recoveredAddress }
    } catch (error: any) {
      return {
        isValid: false,
        error: `Signature verification error: ${error.message}`
      }
    }
  }

  /**
   * Convert ExactEvmPayload to EVMPayAuth format
   */
  private convertExactEvmPayloadToPayAuth(payload: ExactEvmPayload): EVMPayAuth {
    console.log('[EVM Convert] Converting payload:', {
      signature: payload.signature,
      authorization: payload.authorization
    })

    // Split signature into v, r, s components
    const sig = ethers.Signature.from(payload.signature)

    const payAuth = {
      from: payload.authorization.from,
      to: payload.authorization.to,
      value: payload.authorization.value,
      validAfter: payload.authorization.validAfter,
      validBefore: payload.authorization.validBefore,
      nonce: payload.authorization.nonce,
      v: sig.v,
      r: sig.r,
      s: sig.s
    }

    console.log('[EVM Convert] Converted to EVMPayAuth:', payAuth)
    return payAuth
  }

  /**
   * Verify standard EVM payment with PaymentPayload and PaymentRequirements
   * Overload for compatibility with route handlers
   */
  async verifyPaymentWithRequirements(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<boolean> {
    try {
      // Check if this is an EVM payload
      if (!isEvmPayload(paymentPayload)) {
        console.error('[EVM Verify] Not an EVM payload')
        return false
      }

      const evmPayload = paymentPayload as ExactEvmPayload

      // Convert to EVMPayAuth format
      const payAuth = this.convertExactEvmPayloadToPayAuth(evmPayload)

      // Verify payment
      const result = await this.verifyPayment(
        payAuth,
        requirements.network,
        requirements.payTo,
        requirements.maxAmountRequired
      )

      return result.isValid
    } catch (error: any) {
      console.error('[EVM Verify] Error:', error)
      return false
    }
  }

  /**
   * Verify standard EVM payment (EIP-3009)
   * Used for non-atomic payments
   */
  async verifyPayment(
    payAuth: EVMPayAuth,
    network: string,
    expectedTo: string,
    expectedValue: string
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      // Validate addresses
      if (!ethers.isAddress(payAuth.from) || !ethers.isAddress(payAuth.to)) {
        return { isValid: false, error: 'Invalid addresses in payment authorization' }
      }

      // Verify EIP-3009 signature
      const sigVerify = await this.verifyTransferWithAuthorization(payAuth, network)
      if (!sigVerify.isValid) {
        return { isValid: false, error: `Signature verification failed: ${sigVerify.error}` }
      }

      // Verify payment recipient
      if (payAuth.to.toLowerCase() !== expectedTo.toLowerCase()) {
        return {
          isValid: false,
          error: `Payment recipient mismatch: expected ${expectedTo}, got ${payAuth.to}`
        }
      }

      // Verify payment amount
      if (BigInt(payAuth.value) < BigInt(expectedValue)) {
        return {
          isValid: false,
          error: `Insufficient payment: expected ${expectedValue}, got ${payAuth.value}`
        }
      }

      return { isValid: true }
    } catch (error: any) {
      console.error('[EVM Verify Payment] Error:', error)
      return {
        isValid: false,
        error: `Payment verification error: ${error.message}`
      }
    }
  }

  /**
   * Verify EVM atomic payment
   * Validates userPay, feePay signatures, and fee calculation
   */
  async verifyAtomicPayment(payload: EVMAtomicPaymentPayload): Promise<{
    isValid: boolean
    error?: string
    feeAmount?: string
  }> {
    try {
      const { userPay, feePay, network } = payload

      // Check if proxy contract is deployed for this network
      const proxyContract = this.getProxyContract(network)
      if (!proxyContract) {
        return {
          isValid: false,
          error: `Atomic payments not yet supported on ${network} - proxy contract not deployed`
        }
      }

      // Basic validation
      if (!userPay || !feePay) {
        return { isValid: false, error: 'Missing userPay or feePay' }
      }

      // Validate addresses
      if (!ethers.isAddress(userPay.from) || !ethers.isAddress(userPay.to)) {
        return { isValid: false, error: 'Invalid addresses in userPay' }
      }
      if (!ethers.isAddress(feePay.from) || !ethers.isAddress(feePay.to)) {
        return { isValid: false, error: 'Invalid addresses in feePay' }
      }

      // Step 1: Verify userPay EIP-3009 signature
      console.log('[EVM Verify Atomic] Verifying userPay signature...')
      const userPaySigVerify = await this.verifyTransferWithAuthorization(userPay, network)
      if (!userPaySigVerify.isValid) {
        return {
          isValid: false,
          error: `userPay signature verification failed: ${userPaySigVerify.error}`
        }
      }
      console.log('[EVM Verify Atomic] userPay signature valid, signer:', userPaySigVerify.recoveredAddress)

      // Step 2: Verify feePay EIP-3009 signature
      console.log('[EVM Verify Atomic] Verifying feePay signature...')
      const feePaySigVerify = await this.verifyTransferWithAuthorization(feePay, network)
      if (!feePaySigVerify.isValid) {
        return {
          isValid: false,
          error: `feePay signature verification failed: ${feePaySigVerify.error}`
        }
      }
      console.log('[EVM Verify Atomic] feePay signature valid, signer:', feePaySigVerify.recoveredAddress)

      // Step 3: Get proxy contract and validate fee calculation
      console.log('[EVM Verify Atomic] Validating fee calculation...')
      const provider = this.getProvider(network)
      const proxy = new ethers.Contract(proxyContract, evmProxyABI, provider)

      // Read fee config from proxy contract
      const [feeReceiver, feeBps]: [string, bigint] = await Promise.all([
        proxy.feeReceiver(),
        proxy.feeBps()
      ])

      console.log('[EVM Verify Atomic] Fee config:', { feeReceiver, feeBps: feeBps.toString() })

      // Validate feePay.to matches feeReceiver
      if (feePay.to.toLowerCase() !== feeReceiver.toLowerCase()) {
        return {
          isValid: false,
          error: `feePay.to (${feePay.to}) does not match feeReceiver (${feeReceiver})`
        }
      }

      // Calculate expected fee: floor(userPay.value * feeBps / 10000)
      const userValue = BigInt(userPay.value)
      const expectedFee = (userValue * feeBps) / BigInt(10000)

      console.log('[EVM Verify Atomic] Fee calculation:', {
        userValue: userValue.toString(),
        feeBps: feeBps.toString(),
        expectedFee: expectedFee.toString(),
        actualFee: feePay.value
      })

      // Validate feePay.value matches expected fee
      if (BigInt(feePay.value) !== expectedFee) {
        return {
          isValid: false,
          error: `feePay.value (${feePay.value}) does not match expected fee (${expectedFee.toString()})`
        }
      }

      // Validate feePay.from matches userPay.to (server pays the fee)
      if (feePay.from.toLowerCase() !== userPay.to.toLowerCase()) {
        return {
          isValid: false,
          error: `feePay.from (${feePay.from}) must equal userPay.to (${userPay.to})`
        }
      }

      console.log('[EVM Verify Atomic] ✅ All verifications passed')

      return {
        isValid: true,
        feeAmount: expectedFee.toString()
      }
    } catch (error: any) {
      console.error('[EVM Verify] Error:', error)
      return {
        isValid: false,
        error: `Verification error: ${error.message}`
      }
    }
  }

  /**
   * Settle standard EVM payment with PaymentPayload and PaymentRequirements
   * Overload for compatibility with route handlers
   */
  async settlePaymentWithRequirements(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Check if this is an EVM payload
      if (!isEvmPayload(paymentPayload)) {
        return { success: false, error: 'Not an EVM payload' }
      }

      const evmPayload = paymentPayload as ExactEvmPayload

      // Convert to EVMPayAuth format
      const payAuth = this.convertExactEvmPayloadToPayAuth(evmPayload)

      // Settle payment
      return await this.settlePayment(payAuth, requirements.network)
    } catch (error: any) {
      console.error('[EVM Settle] Error:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Settle standard EVM payment (EIP-3009)
   * Submits transferWithAuthorization transaction
   */
  async settlePayment(
    payAuth: EVMPayAuth,
    network: string
  ): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    try {
      if (!this.facilitatorWallet) {
        console.error('Facilitator wallet not configured')
        return {
          success: false,
          error: 'Facilitator wallet not configured'
        }
      }

      const usdcAddress = this.getUSDCAddress(network)
      const provider = this.getProvider(network)
      const signer = this.facilitatorWallet.connect(provider)

      // USDC contract ABI (minimal, only transferWithAuthorization)
      const usdcABI = [
        'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external'
      ]

      const usdc = new ethers.Contract(usdcAddress, usdcABI, signer)

      console.log('[EVM Settle Payment] Calling transferWithAuthorization:', {
        from: payAuth.from,
        to: payAuth.to,
        value: payAuth.value,
        network
      })

      // Call transferWithAuthorization
      const tx = await usdc.transferWithAuthorization(
        payAuth.from,
        payAuth.to,
        payAuth.value,
        payAuth.validAfter,
        payAuth.validBefore,
        payAuth.nonce,
        payAuth.v,
        payAuth.r,
        payAuth.s
      )

      console.log('[EVM Settle Payment] Transaction submitted:', tx.hash)

      // Wait for confirmation
      const receipt = await tx.wait()

      console.log('[EVM Settle Payment] Transaction confirmed:', {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status
      })

      return {
        success: receipt.status === 1,
        transactionHash: receipt.hash
      }
    } catch (error: any) {
      console.error('[EVM Settle Payment] Error:', error)
      console.error('[EVM Settle Payment] Error details:', {
        message: error.message,
        code: error.code,
        reason: error.reason,
        transaction: error.transaction,
        receipt: error.receipt
      })
      return {
        success: false,
        error: `Settlement error: ${error.message}${error.reason ? ` (${error.reason})` : ''}`
      }
    }
  }

  /**
   * Settle EVM atomic payment
   * Calls proxy contract to execute userPay -> feePay -> callback atomically
   */
  async settleAtomicPayment(payload: EVMAtomicPaymentPayload): Promise<{
    success: boolean
    transactionHash?: string
    error?: string
  }> {
    try {
      if (!this.facilitatorWallet) {
        console.error('Facilitator wallet not configured')
        return {
          success: false,
          error: 'Facilitator wallet not configured'
        }
      }

      const { userPay, feePay, target, callback, network } = payload

      // Get proxy contract address from facilitator configuration
      const proxyContract = this.getProxyContract(network)
      if (!proxyContract) {
        return {
          success: false,
          error: `Atomic payments not yet supported on ${network} - proxy contract not deployed`
        }
      }

      // Get provider and connect wallet
      const provider = this.getProvider(network)
      const signer = this.facilitatorWallet.connect(provider)

      // Get proxy contract instance
      const proxy = new ethers.Contract(proxyContract, evmProxyABI, signer)

      console.log('[EVM Settle] Calling proxy contract:', {
        proxy: proxyContract,
        userPay: `${userPay.from} -> ${userPay.to}: ${userPay.value}`,
        feePay: `${feePay.from} -> ${feePay.to}: ${feePay.value}`,
        target,
        callbackLength: callback.length,
      })

      // Convert PayAuth to contract format (tuple)
      const userPayTuple = [
        userPay.from,
        userPay.to,
        userPay.value,
        userPay.validAfter,
        userPay.validBefore,
        userPay.nonce,
        userPay.v,
        userPay.r,
        userPay.s
      ]

      const feePayTuple = [
        feePay.from,
        feePay.to,
        feePay.value,
        feePay.validAfter,
        feePay.validBefore,
        feePay.nonce,
        feePay.v,
        feePay.r,
        feePay.s
      ]

      // Call settle function
      const tx = await proxy.settleUserToServerWithFixedFeeAndCallback(
        userPayTuple,
        feePayTuple,
        target || ethers.ZeroAddress, // Use zero address if no callback
        callback || '0x'
      )

      console.log('[EVM Settle] Transaction submitted:', tx.hash)

      // Wait for confirmation
      const receipt = await tx.wait()

      console.log('[EVM Settle] Transaction confirmed:', {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status
      })

      return {
        success: receipt.status === 1,
        transactionHash: receipt.hash
      }
    } catch (error: any) {
      console.error('[EVM Settle] Error:', error)
      return {
        success: false,
        error: `Settlement error: ${error.message}`
      }
    }
  }
}

// Export singleton instance
export const evmService = new EVMService()
