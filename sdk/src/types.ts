// X402 SDK Types

// Chain type classification
export type ChainType = 'svm' | 'evm'

// Network definitions
export type SolanaNetwork = 'solana' | 'solana-devnet'
export type EVMNetwork = 'base' | 'base-sepolia'
export type Network = SolanaNetwork | EVMNetwork

export type Scheme = 'exact'
export type X402Version = 1

// Helper to determine chain type from network
export function getChainType(network: Network): ChainType {
  if (network === 'solana' || network === 'solana-devnet') {
    return 'svm'
  }
  return 'evm'
}

export interface SerializedInstruction {
  programId: string
  keys: Array<{
    pubkey: string
    isSigner: boolean
    isWritable: boolean
  }>
  data: string // Base64 encoded
}

// Output schema for documenting API endpoints
export interface PropertySchema {
  type: string
  description?: string
  required?: boolean
  enum?: string[]
  items?: PropertySchema
  properties?: Record<string, PropertySchema>
}

export interface HttpInputSchema {
  type: 'http'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  discoverable?: boolean
  properties?: Record<string, PropertySchema>
}

export interface HttpOutputSchema {
  type: 'http'
  properties?: Record<string, PropertySchema>
}

export interface OutputSchema {
  input: HttpInputSchema
  output: HttpOutputSchema
}

export interface PaymentRequirements {
  scheme: Scheme
  network: Network
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  outputSchema?: OutputSchema
  extra?: {
    feePayer?: string
    computeUnitPrice?: number
    computeUnitLimit?: number
    callbackInstructions?: SerializedInstruction[]
    [key: string]: any
  }
}

export interface X402Response {
  x402Version: X402Version
  error?: string
  accepts?: PaymentRequirements[]
  payer?: string
}

export interface VerifyRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
}

export interface VerifyResponse {
  isValid: boolean
  error?: string
}

// Atomic verify request - for verifying atomic transactions
export interface AtomicVerifyRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
}

export interface AtomicVerifyResponse {
  isValid: boolean
  error?: string
}

export interface SettleRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
}

export interface SettleResponse {
  success: boolean
  transactionHash?: string
  error?: string
}

// Atomic operation types - combines settlement with callback execution
export interface AtomicSettleRequest {
  x402Version: X402Version
  paymentPayload: any
  paymentRequirements: PaymentRequirements
  callback: CallbackTransaction
}

export interface CallbackTransaction {
  // For EVM: target contract and calldata
  // For Solana: array of instructions
  type: 'evm' | 'solana'
  data: EVMCallbackData | SolanaCallbackData
}

export interface EVMCallbackData {
  target: string      // Contract address to call (zero address to skip callback)
  calldata: string    // Encoded function call data
}

export interface SolanaCallbackData {
  instructions: SerializedInstruction[]
}

export interface AtomicSettleResponse {
  success: boolean
  settlementTxHash?: string
  callbackTxHash?: string
  error?: string
}

// Simplified payment requirements for route configuration
export interface RoutePaymentRequirements {
  maxAmountRequired?: string
  payTo?: string
  description?: string
  resource?: string
  mimeType?: string
  maxTimeoutSeconds?: number
  asset?: string
  outputSchema?: OutputSchema
  extra?: {
    feePayer?: string
    computeUnitPrice?: number
    computeUnitLimit?: number
    callbackInstructions?: SerializedInstruction[]
    [key: string]: any
  }
}

// Route configuration for different paths
export interface RouteConfig {
  path: string | RegExp
  network?: Network // Optional: override global network for this specific route
  // Can be static requirements or dynamic generator
  paymentRequirements: RoutePaymentRequirements | ((req: any) => Promise<RoutePaymentRequirements> | RoutePaymentRequirements)
  atomic?: boolean // Use atomic verification and settlement (requires serverKeypair in X402Config)
  autoSettle?: boolean
  onPaymentVerified?: (payment: PaymentPayload, req: any) => Promise<void>
  onPaymentSettled?: (payment: PaymentPayload, txHash: string, req: any) => Promise<void>
  // For atomic operations: generate callback transaction/instructions
  onGenerateCallback?: (payment: PaymentPayload, req: any) => Promise<CallbackTransaction>
}

// Wallet configuration - at least one wallet type must be provided
export interface WalletConfig {
  svm?: {
    keypair: string // Base58 encoded Solana Keypair
  }
  evm?: {
    privateKey: string // Hex encoded private key (with or without 0x prefix)
    address?: string // Optional: will be derived from privateKey if not provided
  }
}

// Main SDK configuration
export interface X402Config {
  network: Network // Default network for all routes (can be overridden per route)
  facilitatorUrl: string
  routes: RouteConfig[]
  defaultPayTo?: string // Optional default payTo address for all routes
  serverWallet?: WalletConfig // Wallet for signing atomic transactions (provide svm, evm, or both)
  onPaymentFailed?: (error: Error, req: any) => Promise<void>
}

// Middleware creation options
export interface X402MiddlewareOptions {
  bypassOnError?: boolean // Continue if facilitator is unavailable
  customHeaders?: Record<string, string>
}

// Client wallet configuration - at least one wallet must be configured
export interface X402ClientWalletConfig {
  svm?: {
    keypair: any // Solana Keypair instance (from @solana/web3.js)
  }
  evm?: {
    privateKey: string // Hex encoded private key
    provider?: any // Optional: ethers.js provider
  }
}

// Helper function to validate wallet config against network
export function validateWalletForNetwork(
  wallet: X402ClientWalletConfig,
  network: Network
): { valid: boolean; error?: string } {
  const chainType = getChainType(network)

  if (chainType === 'svm' && !wallet.svm) {
    return {
      valid: false,
      error: `Network '${network}' requires SVM wallet (Solana Keypair) but only EVM wallet is configured`
    }
  }

  if (chainType === 'evm' && !wallet.evm) {
    return {
      valid: false,
      error: `Network '${network}' requires EVM wallet (private key) but only SVM wallet is configured`
    }
  }

  return { valid: true }
}

// =============================================================================
// EVM Atomic Transaction Types (EIP-3009 transferWithAuthorization)
// =============================================================================

/**
 * PayAuth structure for USDC transferWithAuthorization (EIP-3009)
 * Used in EVM atomic transactions
 */
export interface EVMPayAuth {
  from: string          // Address of the token holder (signer)
  to: string            // Address of the recipient
  value: string         // Amount of tokens (in wei, e.g., "1000000" for 1 USDC)
  validAfter: string    // Unix timestamp after which the authorization is valid
  validBefore: string   // Unix timestamp before which the authorization is valid
  nonce: string         // Unique nonce (bytes32 as hex string)
  v: number             // ECDSA signature component
  r: string             // ECDSA signature component (bytes32 as hex string)
  s: string             // ECDSA signature component (bytes32 as hex string)
}

/**
 * Solana Payment Payload (before middleware processing)
 * Contains a serialized transaction that will be signed by server
 */
export interface SolanaPaymentPayload {
  transaction: string        // Base64 encoded serialized transaction
}

/**
 * EVM Payment Payload (before middleware processing)
 * Contains user's USDC transfer authorization
 */
export interface EVMPaymentPayload {
  userPay: EVMPayAuth        // User -> Server USDC authorization
}

/**
 * EVM Atomic Payment Payload (after middleware processing)
 * Includes user payment authorization, server fee payment authorization, and callback info
 */
export interface EVMAtomicPaymentPayload {
  userPay: EVMPayAuth        // User -> Server USDC authorization
  feePay: EVMPayAuth         // Server -> Facilitator fee authorization
  target: string             // Callback target contract address (zero address to skip)
  callback: string           // Callback calldata (hex string)
  proxyContract: string      // Address of the X402 proxy contract
  network: EVMNetwork        // Which EVM network (base, base-sepolia, etc.)
}

/**
 * Payment payload union type for onGenerateCallback
 */
export type PaymentPayload = SolanaPaymentPayload | EVMPaymentPayload | EVMAtomicPaymentPayload

/**
 * EVM Atomic Verify Request
 */
export interface EVMAtomicVerifyRequest {
  x402Version: X402Version
  paymentPayload: EVMAtomicPaymentPayload
  paymentRequirements: PaymentRequirements
}

/**
 * EVM Atomic Verify Response
 */
export interface EVMAtomicVerifyResponse {
  isValid: boolean
  error?: string
  feeAmount?: string        // Calculated fee amount for verification
}

/**
 * EVM Atomic Settle Request
 */
export interface EVMAtomicSettleRequest {
  x402Version: X402Version
  paymentPayload: EVMAtomicPaymentPayload
  paymentRequirements: PaymentRequirements
}

/**
 * EVM Atomic Settle Response
 */
export interface EVMAtomicSettleResponse {
  success: boolean
  transactionHash?: string
  error?: string
}