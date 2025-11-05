import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token'
import axios from 'axios'
import { PaymentRequirements } from './types'

const USDC_MINTS: Record<string, string> = {
  'solana': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
}

export interface X402ClientConfig {
  serverUrl: string
  payerKeypair: Keypair
  network?: 'solana' | 'solana-devnet'
}

export interface X402PaymentResponse {
  x402Version: number
  error?: string
  accepts?: PaymentRequirements[]
}

export class X402Client {
  private serverUrl: string
  private payer: Keypair
  private connection?: Connection
  private network: 'solana' | 'solana-devnet'

  constructor(config: X402ClientConfig) {
    this.serverUrl = config.serverUrl
    this.payer = config.payerKeypair
    this.network = config.network || 'solana-devnet'
  }

  /**
   * Fetch payment requirements from a 402 response
   */
  async getPaymentRequirements(endpoint: string): Promise<PaymentRequirements | null> {
    try {
      await axios.get(`${this.serverUrl}${endpoint}`)
      return null // No payment required
    } catch (error: any) {
      if (error.response?.status === 402) {
        const response: X402PaymentResponse = error.response.data
        if (response.accepts && response.accepts.length > 0) {
          return response.accepts[0]
        }
      }
      throw error
    }
  }

  /**
   * Create a payment transaction based on requirements
   */
  async createPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    // Set up connection based on network
    const rpcUrl = requirements.network === 'solana'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com'

    this.connection = new Connection(rpcUrl, 'confirmed')

    // Get USDC mint for the network
    const usdcMint = new PublicKey(requirements.asset || USDC_MINTS[requirements.network])
    const recipientPubkey = new PublicKey(requirements.payTo!)
    const amount = requirements.maxAmountRequired!

    // Get token accounts
    const payerATA = await getAssociatedTokenAddress(
      usdcMint,
      this.payer.publicKey
    )

    const recipientATA = await getAssociatedTokenAddress(
      usdcMint,
      recipientPubkey
    )

    // Check if recipient ATA exists
    const recipientATAInfo = await this.connection.getAccountInfo(recipientATA)
    const needsATACreation = !recipientATAInfo

    // Determine fee payer
    let feePayer = this.payer.publicKey
    if (requirements.extra?.feePayer) {
      feePayer = new PublicKey(requirements.extra.feePayer)
    }

    // Get latest blockhash
    const { blockhash } = await this.connection.getLatestBlockhash()

    // Create transaction instructions
    const instructions = []

    // Add compute budget instructions
    const computeLimit = requirements.extra?.computeUnitLimit || (needsATACreation ? 40000 : 200000)
    const computePrice = requirements.extra?.computeUnitPrice || 0

    if (computePrice > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computePrice })
      )
    }

    if (computeLimit > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeLimit })
      )
    }

    // Add ATA creation instruction if needed
    if (needsATACreation) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          feePayer,
          recipientATA,
          recipientPubkey,
          usdcMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }

    // Add USDC transfer instruction
    instructions.push(
      createTransferInstruction(
        payerATA,
        recipientATA,
        this.payer.publicKey,
        BigInt(amount)
      )
    )

    // Create versioned transaction
    const messageV0 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message()

    const transaction = new VersionedTransaction(messageV0)

    // Sign with payer
    transaction.sign([this.payer])

    // Serialize to base64
    return Buffer.from(transaction.serialize()).toString('base64')
  }

  /**
   * Make a request with payment
   */
  async requestWithPayment(endpoint: string, options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: any
    headers?: Record<string, string>
  } = {}): Promise<any> {
    // Try request without payment first
    try {
      const response = await axios({
        url: `${this.serverUrl}${endpoint}`,
        method: options.method || 'GET',
        data: options.data,
        headers: options.headers
      })
      return response.data
    } catch (error: any) {
      // If 402, get requirements and pay
      if (error.response?.status === 402) {
        const paymentResponse: X402PaymentResponse = error.response.data
        if (!paymentResponse.accepts || paymentResponse.accepts.length === 0) {
          throw new Error('No payment requirements provided')
        }

        const requirements = paymentResponse.accepts[0]

        // Create payment transaction
        const paymentTx = await this.createPaymentTransaction(requirements)

        // Create payment payload
        const paymentPayload = { transaction: paymentTx }
        const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

        // Retry with payment header
        const response = await axios({
          url: `${this.serverUrl}${endpoint}`,
          method: options.method || 'GET',
          data: options.data,
          headers: {
            ...options.headers,
            'X-X402-Payment': paymentHeader
          }
        })

        return response.data
      }

      throw error
    }
  }

  /**
   * Get payer's public key
   */
  getPayerPublicKey(): string {
    return this.payer.publicKey.toBase58()
  }
}
