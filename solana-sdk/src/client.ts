import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  TransactionInstruction
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token'
import { ethers } from 'ethers'
import axios from 'axios'
import {
  PaymentRequirements,
  SerializedInstruction,
  X402ClientWalletConfig,
  validateWalletForNetwork,
  Network,
  getChainType,
  SolanaNetwork,
  EVMNetwork
} from './types'
import { evmTransactionBuilder } from './evm-utils'

const USDC_MINTS: Record<string, string> = {
  'solana': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
}

export interface X402ClientConfig {
  serverUrl: string
  wallet: X402ClientWalletConfig // Support both SVM and EVM wallets
}

export interface X402PaymentResponse {
  x402Version: number
  error?: string
  accepts?: PaymentRequirements[]
}

export class X402Client {
  private serverUrl: string
  private wallet: X402ClientWalletConfig
  private connection?: Connection

  constructor(config: X402ClientConfig) {
    this.serverUrl = config.serverUrl
    this.wallet = config.wallet

    // Validate that at least one wallet is configured
    if (!this.wallet.svm && !this.wallet.evm) {
      throw new Error('At least one wallet (SVM or EVM) must be configured')
    }

    console.log('[X402 Client] Initialized with wallets:', {
      svm: this.wallet.svm ? `${this.wallet.svm.keypair.publicKey.toBase58()}` : 'not configured',
      evm: this.wallet.evm ? 'configured' : 'not configured'
    })
  }

  /**
   * Fetch payment requirements from a 402 response
   */
  async getPaymentRequirements(endpoint: string, params?: Record<string, any>): Promise<PaymentRequirements | null> {
    try {
      await axios.get(`${this.serverUrl}${endpoint}`, { params })
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
   * Validate wallet configuration against payment requirements network
   */
  private validateWalletForRequirements(requirements: PaymentRequirements): void {
    const validation = validateWalletForNetwork(this.wallet, requirements.network)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  /**
   * Create a Solana payment transaction
   */
  private async createSolanaPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    if (!this.wallet.svm) {
      throw new Error('SVM wallet not configured')
    }

    const payer = this.wallet.svm.keypair

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
      payer.publicKey
    )

    const recipientATA = await getAssociatedTokenAddress(
      usdcMint,
      recipientPubkey
    )

    // Check if recipient ATA exists
    const recipientATAInfo = await this.connection.getAccountInfo(recipientATA)
    const needsATACreation = !recipientATAInfo

    // Determine fee payer
    let feePayer = payer.publicKey
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
        payer.publicKey,
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
    transaction.sign([payer])

    // Serialize to base64
    return Buffer.from(transaction.serialize()).toString('base64')
  }

  /**
   * Create an EVM payment transaction
   */
  private async createEVMPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    if (!this.wallet.evm) {
      throw new Error('EVM wallet not configured')
    }

    return await evmTransactionBuilder.createPaymentTransaction(
      requirements,
      this.wallet.evm.privateKey
    )
  }

  /**
   * Create a payment transaction based on requirements
   */
  async createPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    // Validate wallet is configured for this network
    this.validateWalletForRequirements(requirements)

    const chainType = getChainType(requirements.network)

    if (chainType === 'svm') {
      return await this.createSolanaPaymentTransaction(requirements)
    } else {
      return await this.createEVMPaymentTransaction(requirements)
    }
  }

  /**
   * Make a request with payment
   */
  async requestWithPayment(endpoint: string, options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: any
    params?: Record<string, any>
    headers?: Record<string, string>
  } = {}): Promise<any> {
    // Try request without payment first
    try {
      const response = await axios({
        url: `${this.serverUrl}${endpoint}`,
        method: options.method || 'GET',
        data: options.data,
        params: options.params,
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
        const chainType = getChainType(requirements.network)
        let paymentHeader: string

        if (chainType === 'evm') {
          // EVM: Use full X402 message structure
          const payload = JSON.parse(paymentTx) // { signature, authorization }
          const paymentMessage = {
            x402Version: 1,
            scheme: requirements.scheme,
            network: requirements.network,
            payload
          }
          paymentHeader = Buffer.from(JSON.stringify(paymentMessage)).toString('base64')
        } else {
          // Solana: Simple format - just the transaction
          const payload = { transaction: paymentTx }
          paymentHeader = Buffer.from(JSON.stringify(payload)).toString('base64')
        }

        // Retry with payment header
        const response = await axios({
          url: `${this.serverUrl}${endpoint}`,
          method: options.method || 'GET',
          data: options.data,
          params: options.params,
          headers: {
            ...options.headers,
            'X-Payment': paymentHeader
          }
        })

        return response.data
      }

      throw error
    }
  }

  /**
   * Validate callback instructions to ensure they don't contain user's wallet as account (Solana only)
   */
  private validateSolanaCallbackInstructions(callbackInstructions: SerializedInstruction[]): void {
    if (!this.wallet.svm) return

    const userWallet = this.wallet.svm.keypair.publicKey.toBase58()

    for (const instruction of callbackInstructions) {
      for (const key of instruction.keys) {
        if (key.pubkey === userWallet) {
          throw new Error(
            `Security violation: Callback instruction contains user's wallet as an account. ` +
            `This could allow the server to access your funds. Transaction rejected.`
          )
        }
      }
    }
  }

  /**
   * Deserialize callback instructions from server (Solana)
   */
  private deserializeCallbackInstructions(serializedInstructions: SerializedInstruction[]): TransactionInstruction[] {
    return serializedInstructions.map(ix => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map(key => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable
      })),
      data: Buffer.from(ix.data, 'base64')
    }))
  }

  /**
   * Create an atomic Solana payment transaction with callback instructions
   */
  private async createSolanaAtomicPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    if (!this.wallet.svm) {
      throw new Error('SVM wallet not configured')
    }

    if (!requirements.extra?.callbackInstructions) {
      throw new Error('No callback instructions provided for atomic transaction')
    }

    const payer = this.wallet.svm.keypair

    // Validate callback instructions for security
    this.validateSolanaCallbackInstructions(requirements.extra.callbackInstructions)

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
      payer.publicKey
    )

    const recipientATA = await getAssociatedTokenAddress(
      usdcMint,
      recipientPubkey
    )

    // Check if recipient ATA exists
    const recipientATAInfo = await this.connection.getAccountInfo(recipientATA)
    const needsATACreation = !recipientATAInfo

    // Determine fee payer
    let feePayer = payer.publicKey
    if (requirements.extra?.feePayer) {
      feePayer = new PublicKey(requirements.extra.feePayer)
    }

    // Get latest blockhash
    const { blockhash } = await this.connection.getLatestBlockhash()

    // Create transaction instructions
    const instructions: TransactionInstruction[] = []

    // Add compute budget instructions (REQUIRED)
    const computeLimit = requirements.extra?.computeUnitLimit || (needsATACreation ? 40000 : 200000)
    const computePrice = requirements.extra?.computeUnitPrice || 1

    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computePrice })
    )
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeLimit })
    )

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

    // Add USDC transfer instruction (REQUIRED)
    instructions.push(
      createTransferInstruction(
        payerATA,
        recipientATA,
        payer.publicKey,
        BigInt(amount)
      )
    )

    // Add server callback instructions
    const callbackInstructions = this.deserializeCallbackInstructions(
      requirements.extra.callbackInstructions
    )
    instructions.push(...callbackInstructions)

    // Create versioned transaction
    const messageV0 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message()

    const transaction = new VersionedTransaction(messageV0)

    // Sign with payer (only user signs, server will sign later)
    transaction.sign([payer])

    // Serialize to base64
    return Buffer.from(transaction.serialize()).toString('base64')
  }

  /**
   * Create an atomic payment transaction with callback instructions
   * Note: Currently only supports Solana (SVM). EVM atomic transactions are not yet implemented.
   */
  async createAtomicPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    // Validate wallet is configured for this network
    this.validateWalletForRequirements(requirements)

    const chainType = getChainType(requirements.network)

    if (chainType === 'svm') {
      return await this.createSolanaAtomicPaymentTransaction(requirements)
    } else {
      throw new Error('EVM atomic transactions are not yet implemented. Only Solana (SVM) atomic payments are currently supported.')
    }
  }

  /**
   * Make a request with atomic payment (includes callback instructions)
   */
  async requestWithAtomicPayment(endpoint: string, options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: any
    params?: Record<string, any>
    headers?: Record<string, string>
  } = {}): Promise<any> {
    // Try request without payment first
    try {
      const response = await axios({
        url: `${this.serverUrl}${endpoint}`,
        method: options.method || 'GET',
        data: options.data,
        params: options.params,
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

        // Check if atomic transaction is required (Solana only)
        const chainType = getChainType(requirements.network)
        if (chainType === 'svm' && !requirements.extra?.callbackInstructions) {
          throw new Error('Endpoint requires atomic payment but no callback instructions provided')
        }
        if (chainType === 'evm') {
          throw new Error('EVM atomic transactions are not yet implemented. Only Solana (SVM) atomic payments are currently supported.')
        }

        // Create atomic payment transaction
        const paymentTx = await this.createAtomicPaymentTransaction(requirements)

        // Create payment payload according to X402 spec
        const payload = { transaction: paymentTx }

        // Build X-Payment header according to X402 spec
        const paymentMessage = {
          x402Version: 1,
          scheme: requirements.scheme,
          network: requirements.network,
          payload
        }
        const paymentHeader = Buffer.from(JSON.stringify(paymentMessage)).toString('base64')

        // Retry with payment header
        const response = await axios({
          url: `${this.serverUrl}${endpoint}`,
          method: options.method || 'GET',
          data: options.data,
          params: options.params,
          headers: {
            ...options.headers,
            'X-Payment': paymentHeader
          }
        })

        return response.data
      }

      throw error
    }
  }

  /**
   * Get payer's public key (SVM)
   */
  getPayerPublicKey(): string | null {
    return this.wallet.svm ? this.wallet.svm.keypair.publicKey.toBase58() : null
  }

  /**
   * Get payer's address (EVM)
   */
  getPayerAddress(): string | null {
    if (!this.wallet.evm) return null
    const wallet = new ethers.Wallet(this.wallet.evm.privateKey)
    return wallet.address
  }

  /**
   * Get wallet info for debugging
   */
  getWalletInfo(): { svm: string | null; evm: string | null } {
    return {
      svm: this.getPayerPublicKey(),
      evm: this.getPayerAddress()
    }
  }
}
