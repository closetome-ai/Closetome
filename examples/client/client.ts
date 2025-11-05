import axios from 'axios'
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
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
import bs58 from 'bs58'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000'

// USDC mints
const USDC_MINTS: Record<string, string> = {
  'solana': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
}

interface X402Response {
  x402Version: number
  error?: string
  accepts?: PaymentRequirements[]
}

interface PaymentRequirements {
  scheme: string
  network: string
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra?: {
    feePayer?: string
    computeUnitPrice?: number
    computeUnitLimit?: number
    [key: string]: any
  }
}

class X402Client {
  private connection?: Connection
  private payer?: Keypair
  private serverUrl: string

  constructor() {
    this.serverUrl = SERVER_URL
    this.initializePayer()
  }

  private initializePayer(): void {
    const secretKeyString = process.env.PAYER_SECRET_KEY
    if (!secretKeyString || secretKeyString === 'your_base58_encoded_secret_key_here') {
      console.error('❌ PAYER_SECRET_KEY not configured in .env')
      console.log('   Please set up a test wallet with devnet USDC')
      console.log('   See README.md for instructions')
      return
    }

    try {
      const secretKey = bs58.decode(secretKeyString)
      this.payer = Keypair.fromSecretKey(secretKey)
      console.log('✅ Payer wallet loaded:', this.payer.publicKey.toBase58())
    } catch (error) {
      console.error('❌ Failed to load payer wallet:', error)
    }
  }

  /**
   * Get payment requirements from 402 response
   */
  async getPaymentRequirements(endpoint: string): Promise<PaymentRequirements | null> {
    console.log('\n📋 Fetching payment requirements...')

    try {
      await axios.get(`${this.serverUrl}${endpoint}`)
      console.log('❌ Endpoint did not return 402')
      return null
    } catch (error: any) {
      if (error.response?.status === 402) {
        const response: X402Response = error.response.data
        console.log('✅ Received 402 Payment Required')

        if (response.accepts && response.accepts.length > 0) {
          const requirements = response.accepts[0]
          console.log('\n📝 Payment Requirements:')
          console.log('   Network:', requirements.network)
          console.log('   Amount:', requirements.maxAmountRequired, `(${parseInt(requirements.maxAmountRequired) / 1_000_000} USDC)`)
          console.log('   Pay to:', requirements.payTo)
          console.log('   Description:', requirements.description)
          console.log('   Asset:', requirements.asset)
          if (requirements.extra?.feePayer) {
            console.log('   Fee payer:', requirements.extra.feePayer)
          }
          return requirements
        }
      }

      console.error('❌ Failed to get payment requirements:', error.message)
      return null
    }
  }

  /**
   * Create a payment transaction based on requirements
   */
  async createPaymentTransaction(requirements: PaymentRequirements): Promise<string> {
    if (!this.payer) {
      throw new Error('Payer wallet not configured')
    }

    console.log('\n💳 Creating payment transaction...')

    // Set up connection based on network
    const rpcUrl = requirements.network === 'solana'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com'

    this.connection = new Connection(rpcUrl, 'confirmed')
    console.log('   Network:', requirements.network)

    // Get USDC mint for the network
    const usdcMint = new PublicKey(requirements.asset || USDC_MINTS[requirements.network])
    console.log('   USDC mint:', usdcMint.toBase58())

    const recipientPubkey = new PublicKey(requirements.payTo)
    const amount = requirements.maxAmountRequired

    console.log('   Amount:', amount, `(${parseInt(amount) / 1_000_000} USDC)`)
    console.log('   Recipient:', requirements.payTo)

    // Get token accounts
    const payerATA = await getAssociatedTokenAddress(
      usdcMint,
      this.payer.publicKey
    )

    const recipientATA = await getAssociatedTokenAddress(
      usdcMint,
      recipientPubkey
    )

    console.log('   Payer ATA:', payerATA.toBase58())
    console.log('   Recipient ATA:', recipientATA.toBase58())

    // Check if recipient ATA exists
    const recipientATAInfo = await this.connection.getAccountInfo(recipientATA)
    const needsATACreation = !recipientATAInfo

    if (needsATACreation) {
      console.log('   ⚠️  Recipient ATA does not exist, will create it')
    }

    // Check if we need to include fee payer
    let feePayer = this.payer.publicKey
    if (requirements.extra?.feePayer) {
      feePayer = new PublicKey(requirements.extra.feePayer)
      console.log('   Using facilitator fee payer:', feePayer.toBase58())
    }

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash()

    // Create transaction with compute budget instructions
    const instructions = []

    // Add compute budget instructions (increase limit if creating ATA)
    const computeLimit = requirements.extra?.computeUnitLimit || needsATACreation ? 40000 : 6592
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })
    )

    // Add ATA creation instruction if needed
    if (needsATACreation) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          feePayer, // payer
          recipientATA, // ata
          recipientPubkey, // owner
          usdcMint, // mint
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
        BigInt(amount),
      )
    )

    // Create versioned transaction
    const messageV0 = new TransactionMessage({
      payerKey: feePayer, // Use fee payer if provided
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message()

    const transaction = new VersionedTransaction(messageV0)

    // Always sign with payer since they need to authorize the token transfer
    transaction.sign([this.payer])

    // Serialize to base64
    const serialized = Buffer.from(transaction.serialize()).toString('base64')

    console.log('✅ Transaction created and signed')
    console.log('   Transaction size:', serialized.length, 'bytes')

    return serialized
  }

  /**
   * Test accessing protected endpoint without payment
   */
  async testWithoutPayment(): Promise<PaymentRequirements | null> {
    console.log('\n🔍 Test 1: Access without payment')
    console.log('────────────────────────────────────')

    return await this.getPaymentRequirements('/api/protected')
  }

  /**
   * Test accessing protected endpoint with payment
   */
  async testWithPayment(requirements: PaymentRequirements): Promise<void> {
    console.log('\n💰 Test 2: Access with payment')
    console.log('────────────────────────────────────')

    if (!this.payer) {
      console.log('❌ Cannot test payment - wallet not configured')
      return
    }

    try {
      // Create payment transaction based on requirements
      const paymentTransaction = await this.createPaymentTransaction(requirements)

      // Create payment payload based on network type
      const paymentPayload = requirements.network.startsWith('solana')
        ? { transaction: paymentTransaction }  // Solana payload
        : { signature: paymentTransaction, authorization: {} } // EVM payload (simplified)

      // Encode payment as base64
      const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

      console.log('\n📤 Sending request with payment header...')
      console.log('   Header length:', paymentHeader.length)

      // Send request with payment header
      const response = await axios.get(`${this.serverUrl}/api/protected`, {
        headers: {
          'X-X402-Payment': paymentHeader
        }
      })

      console.log('\n✅ Success! Protected endpoint accessed')
      console.log('   Response:', JSON.stringify(response.data, null, 2))

      if (response.data.payment?.transactionHash) {
        const explorer = requirements.network === 'solana-devnet'
          ? 'https://explorer.solana.com/tx/' + response.data.payment.transactionHash + '?cluster=devnet'
          : 'https://explorer.solana.com/tx/' + response.data.payment.transactionHash

        console.log('\n🔗 Transaction confirmed on Solana')
        console.log(`   View on explorer: ${explorer}`)
      }
    } catch (error: any) {
      console.error('\n❌ Request failed:', error.response?.data || error.message)
      if (error.response?.data?.error) {
        console.error('   Error details:', error.response.data.error)
      }
    }
  }

  /**
   * Test health endpoint (no payment required)
   */
  async testHealthEndpoint(): Promise<void> {
    console.log('\n❤️  Test 0: Health check')
    console.log('────────────────────────────────────')

    try {
      const response = await axios.get(`${this.serverUrl}/health`)
      console.log('✅ Server is healthy:', response.data)
    } catch (error: any) {
      console.error('❌ Server is not responding:', error.message)
      throw new Error('Server not available')
    }
  }

  /**
   * Run all tests
   */
  async runTests(): Promise<void> {
    console.log(`
╔════════════════════════════════════════════════════╗
║         X402 Client - Testing Payment Flow        ║
╚════════════════════════════════════════════════════╝

📍 Configuration:
   - Server: ${this.serverUrl}
   - Wallet: ${this.payer?.publicKey.toBase58() || 'Not configured'}
`)

    try {
      // Test 0: Health check
      await this.testHealthEndpoint()

      // Test 1: Get payment requirements from 402 response
      const requirements = await this.testWithoutPayment()

      if (requirements) {
        // Test 2: Make payment based on requirements
        await this.testWithPayment(requirements)
      } else {
        console.log('\n⚠️  Could not get payment requirements')
      }

      console.log('\n✅ All tests completed!')
    } catch (error) {
      console.error('\n❌ Tests failed:', error)
      process.exit(1)
    }
  }
}

// Run the client
async function main() {
  const client = new X402Client()
  await client.runTests()
}

main().catch(console.error)