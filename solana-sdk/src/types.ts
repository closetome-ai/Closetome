// X402 SDK Types

export type Network = 'solana' | 'solana-devnet' | 'base' | 'base-sepolia'
export type Scheme = 'exact'
export type X402Version = 1

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
  // For EVM: encoded transaction data
  // For Solana: array of instructions
  type: 'evm' | 'solana'
  data: any // This will be more specifically typed once facilitator defines the format
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
  // Can be static requirements or dynamic generator
  paymentRequirements: RoutePaymentRequirements | ((req: any) => Promise<RoutePaymentRequirements> | RoutePaymentRequirements)
  atomic?: boolean // Use atomic verification and settlement (requires serverKeypair in X402Config)
  autoSettle?: boolean
  onPaymentVerified?: (payment: any, req: any) => Promise<void>
  onPaymentSettled?: (payment: any, txHash: string, req: any) => Promise<void>
  // For atomic operations: generate callback transaction/instructions
  onGenerateCallback?: (payment: any, req: any) => Promise<CallbackTransaction>
}

// Main SDK configuration
export interface X402Config {
  network: Network
  facilitatorUrl: string
  routes: RouteConfig[]
  defaultPayTo?: string // Optional default payTo address for all routes
  serverKeypair?: string // Base58 encoded Keypair for signing atomic transactions (Solana only)
  onPaymentFailed?: (error: Error, req: any) => Promise<void>
}

// Middleware creation options
export interface X402MiddlewareOptions {
  bypassOnError?: boolean // Continue if facilitator is unavailable
  customHeaders?: Record<string, string>
}