import {
  Connection,
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  ComputeBudgetProgram,
  VersionedMessage
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token'
import { PaymentRequirements, ExactSvmPayload, isSvmPayload, PaymentPayload, SerializedInstruction } from '../types'
import bs58 from 'bs58'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({
  path: path.join(__dirname, '../../.env'),
})

// USDC mint addresses
const USDC_MINT_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const USDC_MINT_DEVNET = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr')

export class SolanaService {
  private connection: Connection
  private feePayerKeypair?: Keypair
  private feePayerPublicKey?: PublicKey
  private computeUnitPrice: number = 1 // Default: no priority fee
  private computeUnitLimit: number = 40000 // Default Solana limit
  private maxComputeUnitLimitAtomic: number = 1000000 // Maximum allowed for atomic transactions to prevent malicious servers from burning user's gas

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    this.connection = new Connection(rpcUrl, 'confirmed')
    this.initializeFeePayerKeypair()
    this.initializeComputeBudgetConfig()
  }

  /**
   * Initialize compute budget configuration from environment
   */
  private initializeComputeBudgetConfig(): void {
    if (process.env.SOLANA_COMPUTE_UNIT_PRICE) {
      this.computeUnitPrice = parseInt(process.env.SOLANA_COMPUTE_UNIT_PRICE)
    }
    if (process.env.SOLANA_COMPUTE_UNIT_LIMIT) {
      this.computeUnitLimit = parseInt(process.env.SOLANA_COMPUTE_UNIT_LIMIT)
    }
    if (process.env.SOLANA_MAX_COMPUTE_UNIT_LIMIT_ATOMIC) {
      this.maxComputeUnitLimitAtomic = parseInt(process.env.SOLANA_MAX_COMPUTE_UNIT_LIMIT_ATOMIC)
    }
  }

  /**
   * Get compute budget configuration
   */
  getComputeBudgetConfig(): { unitPrice: number; unitLimit: number; maxUnitLimitAtomic: number } {
    return {
      unitPrice: this.computeUnitPrice,
      unitLimit: this.computeUnitLimit,
      maxUnitLimitAtomic: this.maxComputeUnitLimitAtomic
    }
  }

  /**
   * Get the fee payer public key if configured
   */
  getFeePayerPublicKey(): string | undefined {
    return this.feePayerPublicKey?.toBase58()
  }

  private initializeFeePayerKeypair(): void {
    const secretKeyString = process.env.SOLANA_FEE_PAYER_SECRET_KEY
    console.log(secretKeyString)
    if (secretKeyString && secretKeyString !== 'your_base58_encoded_secret_key_here') {
      try {
        const secretKey = bs58.decode(secretKeyString)
        this.feePayerKeypair = Keypair.fromSecretKey(secretKey)
        this.feePayerPublicKey = this.feePayerKeypair.publicKey
        console.log('Fee payer initialized:', this.feePayerPublicKey.toBase58())
      } catch (error) {
        console.error('Failed to initialize fee payer keypair:', error)
      }
    } else {
      console.warn('SOLANA_FEE_PAYER_SECRET_KEY not configured - fee payer functionality disabled')
    }
  }

  /**
   * Decompile all instructions from a transaction message
   */
  private decompileInstructions(message: VersionedMessage): TransactionInstruction[] {
    try {
      const messageV0 = TransactionMessage.decompile(message)
      return messageV0.instructions
    } catch (error) {
      console.error('Failed to decompile instructions:', error)
      return []
    }
  }

  /**
   * Check if an instruction is a compute budget instruction
   */
  private isComputeBudgetInstruction(instruction: TransactionInstruction): boolean {
    return instruction.programId.equals(ComputeBudgetProgram.programId)
  }

  /**
   * Check if instruction is SetComputeUnitLimit
   */
  private isSetComputeUnitLimit(instruction: TransactionInstruction): boolean {
    if (!this.isComputeBudgetInstruction(instruction)) return false
    // SetComputeUnitLimit has instruction type 2
    return instruction.data.length >= 1 && instruction.data[0] === 2
  }

  /**
   * Check if instruction is SetComputeUnitPrice
   */
  private isSetComputeUnitPrice(instruction: TransactionInstruction): boolean {
    if (!this.isComputeBudgetInstruction(instruction)) return false
    // SetComputeUnitPrice has instruction type 3
    return instruction.data.length >= 1 && instruction.data[0] === 3
  }

  /**
   * Get compute unit limit value from instruction
   */
  private getComputeUnitLimit(instruction: TransactionInstruction): number {
    if (!this.isSetComputeUnitLimit(instruction)) return 0
    // Units are stored as u32 little-endian at offset 1
    return instruction.data.readUInt32LE(1)
  }

  /**
   * Get compute unit price value from instruction
   */
  private getComputeUnitPrice(instruction: TransactionInstruction): number {
    if (!this.isSetComputeUnitPrice(instruction)) return 0
    // microLamports are stored as u64 little-endian at offset 1
    // For simplicity, we'll read just the lower 32 bits (enough for most prices)
    return instruction.data.readUInt32LE(1)
  }

  /**
   * Check if instruction is an ATA creation instruction (both regular and idempotent)
   */
  private isATACreationInstruction(instruction: TransactionInstruction): boolean {
    // Check if it's the Associated Token Program
    if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      return false
    }

    // Check instruction data
    // Regular createAssociatedTokenAccount has no data or 0 discriminator
    // createAssociatedTokenAccountIdempotent has discriminator 1
    if (instruction.data.length === 0 ||
        (instruction.data.length === 1 && (instruction.data[0] === 0 || instruction.data[0] === 1))) {
      return true
    }

    return false
  }

  /**
   * Parse ATA creation instruction details
   */
  private parseATACreationInstruction(instruction: TransactionInstruction): {
    payer: PublicKey
    ata: PublicKey
    owner: PublicKey
    mint: PublicKey
    isIdempotent: boolean
  } | null {
    if (!this.isATACreationInstruction(instruction)) return null

    // ATA creation instruction has specific account order:
    // 0: payer (signer, writable)
    // 1: associated token account (writable)
    // 2: owner
    // 3: mint
    // 4: system program
    // 5: token program
    // 6: (optional) rent sysvar for older versions

    if (instruction.keys.length < 6) return null

    const isIdempotent = instruction.data.length > 0 && instruction.data[0] === 1

    return {
      payer: instruction.keys[0].pubkey,
      ata: instruction.keys[1].pubkey,
      owner: instruction.keys[2].pubkey,
      mint: instruction.keys[3].pubkey,
      isIdempotent
    }
  }

  /**
   * Check if instruction is a token transfer instruction
   */
  private isTokenTransferInstruction(instruction: TransactionInstruction): boolean {
    // Check if it's Token Program
    if (!instruction.programId.equals(TOKEN_PROGRAM_ID)) {
      return false
    }

    // SPL Token transfer instruction has discriminator 3 for regular transfer
    // or 12 for transferChecked
    if (instruction.data.length >= 1) {
      const discriminator = instruction.data[0]
      return discriminator === 3 || discriminator === 12
    }

    return false
  }

  /**
   * Parse USDC transfer instruction details
   */
  private parseUSDCTransferInstruction(instruction: TransactionInstruction): {
    source: PublicKey | null
    destination: PublicKey | null
    amount: bigint
  } | null {
    if (!this.isTokenTransferInstruction(instruction)) return null

    const discriminator = instruction.data[0]

    if (discriminator === 3) {
      // Regular transfer: [discriminator(1), amount(8)]
      if (instruction.data.length < 9) return null

      const amount = instruction.data.readBigUInt64LE(1)

      // Keys: [source, destination, authority]
      if (instruction.keys.length < 3) return null

      return {
        source: instruction.keys[0]?.pubkey || null,
        destination: instruction.keys[1]?.pubkey || null,
        amount
      }
    } else if (discriminator === 12) {
      // TransferChecked: [discriminator(1), amount(8), decimals(1)]
      if (instruction.data.length < 10) return null

      const amount = instruction.data.readBigUInt64LE(1)

      // Keys: [source, mint, destination, authority]
      if (instruction.keys.length < 4) return null

      return {
        source: instruction.keys[0]?.pubkey || null,
        destination: instruction.keys[2]?.pubkey || null,
        amount
      }
    }

    return null
  }

  /**
   * Verify a Solana payment according to new requirements
   */
  async verifyPayment(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<boolean> {
    try {
      // Check if this is a Solana payload
      if (!isSvmPayload(paymentPayload)) {
        console.error('Invalid payment payload: not a Solana transaction')
        return false
      }

      const svmPayload = paymentPayload as ExactSvmPayload

      if (!svmPayload.transaction || typeof svmPayload.transaction !== 'string') {
        console.error('Invalid payment payload: missing or invalid transaction')
        return false
      }

      // Parse the transaction
      const transactionBuffer = Buffer.from(svmPayload.transaction, 'base64')
      const transaction = VersionedTransaction.deserialize(transactionBuffer)
      const message = transaction.message
      const instructions = this.decompileInstructions(message)

      if (instructions.length === 0) {
        console.error('No instructions found in transaction')
        return false
      }

      // Get compute budget config from requirements or use defaults
      const requiredUnitPrice = requirements.extra?.computeUnitPrice ?? this.computeUnitPrice
      const requiredUnitLimit = requirements.extra?.computeUnitLimit ?? this.computeUnitLimit

      // Step 1: Check compute budget instructions if present
      let hasComputeLimit = false
      let hasUnitPrice = false
      let foundUnitLimit = 0
      let foundUnitPrice = 0

      for (const instruction of instructions) {
        if (this.isSetComputeUnitLimit(instruction)) {
          hasComputeLimit = true
          foundUnitLimit = this.getComputeUnitLimit(instruction)
        }
        if (this.isSetComputeUnitPrice(instruction)) {
          hasUnitPrice = true
          foundUnitPrice = this.getComputeUnitPrice(instruction)
        }
      }

      // If compute budget instructions exist, validate them
      if (hasComputeLimit || hasUnitPrice) {
        // If only one exists, both should exist
        if (!hasComputeLimit || !hasUnitPrice) {
          console.error('Incomplete compute budget instructions')
          return false
        }

        // Validate unit price if specified in config
        if (requiredUnitPrice > 0 && foundUnitPrice !== requiredUnitPrice) {
          console.error(`Incorrect unit price: ${foundUnitPrice}, expected ${requiredUnitPrice}`)
          return false
        }

        // Validate unit limit if specified in config
        if (requiredUnitLimit > 0 && foundUnitLimit !== requiredUnitLimit) {
          // Allow higher limit for ATA creation
          const hasATACreation = instructions.some(ix => this.isATACreationInstruction(ix))
          if (!hasATACreation || foundUnitLimit > requiredUnitLimit * 2) {
            console.error(`Incorrect compute limit: ${foundUnitLimit}, expected ${requiredUnitLimit}`)
            return false
          }
        }
      }

      // Step 2: Find and validate ATA creation instruction if present
      let ataCreationInstruction = null
      let ataCreationDetails = null

      for (const instruction of instructions) {
        if (this.isATACreationInstruction(instruction)) {
          ataCreationInstruction = instruction
          ataCreationDetails = this.parseATACreationInstruction(instruction)
          break
        }
      }

      // Step 3: Find and validate transfer instruction
      let transferInstruction = null
      let transferDetails = null

      for (const instruction of instructions) {
        if (this.isTokenTransferInstruction(instruction)) {
          transferInstruction = instruction
          transferDetails = this.parseUSDCTransferInstruction(instruction)
          break
        }
      }

      if (!transferInstruction || !transferDetails) {
        console.error('No token transfer instruction found')
        return false
      }

      // Validate transfer destination
      if (!transferDetails.destination) {
        console.error('Transfer destination is null')
        return false
      }

      // If ATA creation exists, validate it
      if (ataCreationInstruction && ataCreationDetails) {
        console.log('Found ATA creation instruction (idempotent:', ataCreationDetails.isIdempotent, ')')

        // Validate that the ATA owner matches the payment recipient
        if (requirements.payTo) {
          const expectedRecipient = new PublicKey(requirements.payTo)
          if (!ataCreationDetails.owner.equals(expectedRecipient)) {
            console.error('ATA owner does not match payment recipient')
            return false
          }
        }

        // Validate that the ATA address is correct for the owner and mint
        const expectedUSDCMint = requirements.network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET
        const expectedATA = await getAssociatedTokenAddress(
          expectedUSDCMint,
          ataCreationDetails.owner
        )

        if (!ataCreationDetails.ata.equals(expectedATA)) {
          console.error('ATA address does not match expected derivation')
          return false
        }

        // Validate that the ATA in creation matches the transfer destination
        if (!ataCreationDetails.ata.equals(transferDetails.destination)) {
          console.error('ATA creation address does not match transfer destination')
          return false
        }
      } else {
        // No ATA creation instruction, check if destination account exists on-chain
        console.log('No ATA creation instruction, checking if destination exists on-chain...')

        const accountInfo = await this.connection.getAccountInfo(transferDetails.destination)
        if (!accountInfo) {
          console.error('Transfer destination account does not exist and no ATA creation instruction found')
          return false
        }

        console.log('Destination account exists on-chain')
      }

      // Validate transfer recipient matches requirements
      if (requirements.payTo) {
        const expectedRecipient = new PublicKey(requirements.payTo)
        const expectedUSDCMint = requirements.network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET
        const expectedATA = await getAssociatedTokenAddress(
          expectedUSDCMint,
          expectedRecipient
        )

        if (!expectedATA.equals(transferDetails.destination)) {
          console.error('Transfer destination does not match expected recipient ATA')
          return false
        }
      }

      // Validate transfer amount
      if (requirements.maxAmountRequired) {
        const requiredAmount = BigInt(requirements.maxAmountRequired)
        if (transferDetails.amount < requiredAmount) {
          console.error(`Insufficient amount: ${transferDetails.amount}, required ${requiredAmount}`)
          return false
        }
      }

      console.log('Payment verification successful')
      return true

    } catch (error) {
      console.error('Error verifying Solana payment:', error)
      return false
    }
  }

  /**
   * Add compute budget instructions if needed
   */
  private async addComputeBudgetInstructions(transaction: VersionedTransaction): Promise<VersionedTransaction> {
    const message = transaction.message
    const instructions = this.decompileInstructions(message)

    let hasComputeLimit = false
    let hasUnitPrice = false

    // Check existing instructions
    for (const instruction of instructions) {
      if (this.isSetComputeUnitLimit(instruction)) {
        hasComputeLimit = true
      }
      if (this.isSetComputeUnitPrice(instruction)) {
        hasUnitPrice = true
      }
    }

    // If both already exist, no need to add
    if (hasComputeLimit && hasUnitPrice) {
      return transaction
    }

    const newInstructions: TransactionInstruction[] = []

    // Add missing compute budget instructions at the beginning
    if (!hasUnitPrice && this.computeUnitPrice > 0) {
      newInstructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.computeUnitPrice
        })
      )
    }

    if (!hasComputeLimit && this.computeUnitLimit > 0) {
      newInstructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: this.computeUnitLimit
        })
      )
    }

    // If we added new instructions, rebuild the transaction
    if (newInstructions.length > 0) {
      newInstructions.push(...instructions)

      const messageV0 = TransactionMessage.decompile(message)
      messageV0.instructions = newInstructions
      const newMessage = messageV0.compileToV0Message()

      // Keep existing signatures if any
      return new VersionedTransaction(newMessage, transaction.signatures)
    }

    return transaction
  }

  /**
   * Settle a Solana payment (submit to blockchain)
   */
  async settlePayment(paymentPayload: PaymentPayload, requirements: PaymentRequirements): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // First run verification
      const isValid = await this.verifyPayment(paymentPayload, requirements)
      if (!isValid) {
        return { success: false, error: 'Payment verification failed' }
      }

      // Check if this is a Solana payload
      if (!isSvmPayload(paymentPayload)) {
        return { success: false, error: 'Invalid payment payload: not a Solana transaction' }
      }

      const svmPayload = paymentPayload as ExactSvmPayload

      if (!svmPayload.transaction || typeof svmPayload.transaction !== 'string') {
        return { success: false, error: 'Invalid payment payload: missing or invalid transaction' }
      }

      // Parse the transaction
      const transactionBuffer = Buffer.from(svmPayload.transaction, 'base64')
      let transaction = VersionedTransaction.deserialize(transactionBuffer)

      // Add compute budget instructions if needed
      transaction = await this.addComputeBudgetInstructions(transaction)

      // Check if fee payer is required
      if (requirements.extra?.feePayer) {
        // Validate that the required fee payer matches our configured fee payer
        if (!this.feePayerPublicKey) {
          return {
            success: false,
            error: 'Fee payer required but not configured on server'
          }
        }

        const requiredFeePayer = requirements.extra.feePayer
        if (requiredFeePayer !== this.feePayerPublicKey.toBase58()) {
          return {
            success: false,
            error: `Fee payer mismatch: expected ${requiredFeePayer}, but server has ${this.feePayerPublicKey.toBase58()}`
          }
        }

        // Sign the transaction with our fee payer keypair
        if (!this.feePayerKeypair) {
          return {
            success: false,
            error: 'Fee payer keypair not available'
          }
        }

        transaction.sign([this.feePayerKeypair])
        console.log('Transaction signed by fee payer')
      }

      // Submit the transaction
      console.log('Submitting transaction to Solana network...')
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      })

      // Wait for confirmation
      console.log('Waiting for confirmation...')
      const latestBlockhash = await this.connection.getLatestBlockhash()
      const confirmation = await this.connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      })

      if (confirmation.value.err) {
        console.error('Transaction failed:', confirmation.value.err)
        return {
          success: false,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        }
      }

      console.log('Transaction confirmed:', signature)
      return {
        success: true,
        transactionHash: signature
      }

    } catch (error: any) {
      console.error('Error settling Solana payment:', error)
      return {
        success: false,
        error: error.message || 'Failed to settle payment'
      }
    }
  }

  /**
   * Serialize an instruction for transmission
   */
  private serializeInstruction(instruction: TransactionInstruction): SerializedInstruction {
    return {
      programId: instruction.programId.toBase58(),
      keys: instruction.keys.map(key => ({
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable
      })),
      data: instruction.data.toString('base64')
    }
  }

  /**
   * Deserialize callback instructions from requirements
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
   * Check if two instructions are equivalent
   * Note: Solana's decompile() automatically sets all signer accounts to isWritable=true,
   * so we only strictly compare isWritable for non-signer accounts
   */
  private instructionsEqual(ix1: TransactionInstruction, ix2: TransactionInstruction): boolean {
    if (!ix1.programId.equals(ix2.programId)) return false
    if (ix1.keys.length !== ix2.keys.length) return false
    if (ix1.data.length !== ix2.data.length) return false

    for (let i = 0; i < ix1.keys.length; i++) {
      const key1 = ix1.keys[i]
      const key2 = ix2.keys[i]

      // Compare pubkey
      if (!key1.pubkey.equals(key2.pubkey)) return false

      // Compare isSigner
      if (key1.isSigner !== key2.isSigner) return false

      // Compare isWritable
      // IMPORTANT: Only strictly compare isWritable for non-signer accounts
      // Solana automatically sets signer accounts to writable during compile/decompile
      // so we ignore isWritable differences for signer accounts
      if (!key1.isSigner && !key2.isSigner) {
        // Both are non-signers, must match exactly
        if (key1.isWritable !== key2.isWritable) return false
      }
      // If either is a signer, we don't compare isWritable (Solana will force it to true)
    }

    if (!ix1.data.equals(ix2.data)) return false

    return true
  }

  /**
   * Verify atomic payment with callback instructions
   */
  async verifyAtomicPayment(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<boolean> {
    try {
      // Check if this is a Solana payload
      if (!isSvmPayload(paymentPayload)) {
        console.error('Invalid payment payload: not a Solana transaction')
        return false
      }

      const svmPayload = paymentPayload as ExactSvmPayload

      if (!svmPayload.transaction || typeof svmPayload.transaction !== 'string') {
        console.error('Invalid payment payload: missing or invalid transaction')
        return false
      }

      // Parse the transaction
      const transactionBuffer = Buffer.from(svmPayload.transaction, 'base64')
      const transaction = VersionedTransaction.deserialize(transactionBuffer)
      const message = transaction.message
      const instructions = this.decompileInstructions(message)

      if (instructions.length === 0) {
        console.error('No instructions found in transaction')
        return false
      }

      // Step 1: Validate compute budget instructions (with max limit check for atomic transactions)
      // Get compute budget config from requirements or use defaults
      const requiredUnitPrice = requirements.extra?.computeUnitPrice ?? this.computeUnitPrice
      const maxAllowedLimit = this.maxComputeUnitLimitAtomic

      let foundComputeLimit = false
      let foundComputePrice = false
      let foundUnitPrice = 0
      let foundUnitLimit = 0

      for (const instruction of instructions) {
        if (this.isSetComputeUnitLimit(instruction)) {
          foundComputeLimit = true
          foundUnitLimit = this.getComputeUnitLimit(instruction)
        }
        if (this.isSetComputeUnitPrice(instruction)) {
          foundComputePrice = true
          foundUnitPrice = this.getComputeUnitPrice(instruction)
        }
      }

      // Validate that both compute budget instructions exist
      if (!foundComputeLimit || !foundComputePrice) {
        console.error('Missing compute budget instructions (both setComputeUnitPrice and setComputeUnitLimit required)')
        return false
      }

      // Validate unit price if specified in config
      if (requiredUnitPrice > 0 && foundUnitPrice !== requiredUnitPrice) {
        console.error(`Incorrect unit price: ${foundUnitPrice}, expected ${requiredUnitPrice}`)
        return false
      }

      // CRITICAL: Validate compute unit limit does not exceed maximum
      // This prevents malicious servers from adding tons of callback instructions to burn user's SOL
      if (foundUnitLimit > maxAllowedLimit) {
        console.error(`Compute unit limit ${foundUnitLimit} exceeds maximum allowed ${maxAllowedLimit} for atomic transactions`)
        console.error('This protects users from malicious servers adding excessive callback instructions')
        return false
      }

      console.log(`Compute unit limit validated: ${foundUnitLimit} <= ${maxAllowedLimit} (max allowed)`)

      // Step 2: Validate transfer and ATA instructions (same as standard verification)
      let ataCreationInstruction = null
      let ataCreationDetails = null

      for (const instruction of instructions) {
        if (this.isATACreationInstruction(instruction)) {
          ataCreationInstruction = instruction
          ataCreationDetails = this.parseATACreationInstruction(instruction)
          break
        }
      }

      // Find and validate transfer instruction
      let transferInstruction = null
      let transferDetails = null

      for (const instruction of instructions) {
        if (this.isTokenTransferInstruction(instruction)) {
          transferInstruction = instruction
          transferDetails = this.parseUSDCTransferInstruction(instruction)
          break
        }
      }

      if (!transferInstruction || !transferDetails) {
        console.error('No token transfer instruction found')
        return false
      }

      // Validate transfer destination
      if (!transferDetails.destination) {
        console.error('Transfer destination is null')
        return false
      }

      // If ATA creation exists, validate it
      if (ataCreationInstruction && ataCreationDetails) {
        console.log('Found ATA creation instruction (idempotent:', ataCreationDetails.isIdempotent, ')')

        // Validate that the ATA owner matches the payment recipient
        if (requirements.payTo) {
          const expectedRecipient = new PublicKey(requirements.payTo)
          if (!ataCreationDetails.owner.equals(expectedRecipient)) {
            console.error('ATA owner does not match payment recipient')
            return false
          }
        }

        // Validate that the ATA address is correct for the owner and mint
        const expectedUSDCMint = requirements.network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET
        const expectedATA = await getAssociatedTokenAddress(
          expectedUSDCMint,
          ataCreationDetails.owner
        )

        if (!ataCreationDetails.ata.equals(expectedATA)) {
          console.error('ATA address does not match expected derivation')
          return false
        }

        // Validate that the ATA in creation matches the transfer destination
        if (!ataCreationDetails.ata.equals(transferDetails.destination)) {
          console.error('ATA creation address does not match transfer destination')
          return false
        }
      } else {
        // No ATA creation instruction, check if destination account exists on-chain
        console.log('No ATA creation instruction, checking if destination exists on-chain...')

        const accountInfo = await this.connection.getAccountInfo(transferDetails.destination)
        if (!accountInfo) {
          console.error('Transfer destination account does not exist and no ATA creation instruction found')
          return false
        }

        console.log('Destination account exists on-chain')
      }

      // Validate transfer recipient matches requirements
      if (requirements.payTo) {
        const expectedRecipient = new PublicKey(requirements.payTo)
        const expectedUSDCMint = requirements.network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET
        const expectedATA = await getAssociatedTokenAddress(
          expectedUSDCMint,
          expectedRecipient
        )

        if (!expectedATA.equals(transferDetails.destination)) {
          console.error('Transfer destination does not match expected recipient ATA')
          return false
        }
      }

      // Validate transfer amount
      if (requirements.maxAmountRequired) {
        const requiredAmount = BigInt(requirements.maxAmountRequired)
        if (transferDetails.amount < requiredAmount) {
          console.error(`Insufficient amount: ${transferDetails.amount}, required ${requiredAmount}`)
          return false
        }
      }

      // Step 3: Verify all callback instructions are present
      if (!requirements.extra?.callbackInstructions) {
        console.error('No callback instructions in requirements')
        return false
      }

      const callbackInstructions = this.deserializeCallbackInstructions(
        requirements.extra.callbackInstructions
      )

      console.log(`Verifying ${callbackInstructions.length} callback instructions...`)

      for (const callbackIx of callbackInstructions) {
        let found = false
        for (const txIx of instructions) {
          if (this.instructionsEqual(callbackIx, txIx)) {
            found = true
            break
          }
        }
        if (!found) {
          console.error('Missing callback instruction:', this.serializeInstruction(callbackIx))
          return false
        }
      }

      console.log('All callback instructions verified')

      // Step 4: Verify instruction structure and order
      // Expected structure:
      // [0-1] setComputeUnitPrice (compute budget)
      // [1-2] setComputeUnitLimit (compute budget)
      // [2-3] createATA (optional)
      // [3-4] transfer (required)
      // [4+]  callback instructions (must match exactly)

      let currentIndex = 0
      let hasComputePrice = false
      let hasComputeLimit = false
      let hasATA = false
      let hasTransfer = false

      // Parse compute budget instructions (must be first 2 instructions)
      while (currentIndex < instructions.length && this.isComputeBudgetInstruction(instructions[currentIndex])) {
        if (this.isSetComputeUnitPrice(instructions[currentIndex])) {
          if (hasComputePrice) {
            console.error('Duplicate setComputeUnitPrice instruction')
            return false
          }
          hasComputePrice = true
        } else if (this.isSetComputeUnitLimit(instructions[currentIndex])) {
          if (hasComputeLimit) {
            console.error('Duplicate setComputeUnitLimit instruction')
            return false
          }
          hasComputeLimit = true
        }
        currentIndex++
      }

      if (!hasComputePrice || !hasComputeLimit) {
        console.error('Missing required compute budget instructions at the beginning')
        return false
      }

      // Check for optional ATA creation instruction
      if (currentIndex < instructions.length && this.isATACreationInstruction(instructions[currentIndex])) {
        hasATA = true
        currentIndex++
      }

      // Check for required transfer instruction
      if (currentIndex < instructions.length && this.isTokenTransferInstruction(instructions[currentIndex])) {
        hasTransfer = true
        currentIndex++
      }

      if (!hasTransfer) {
        console.error('Missing required transfer instruction after compute budget')
        return false
      }

      console.log(`Validated payment instructions: compute budget(2) + ATA(${hasATA ? 1 : 0}) + transfer(1)`)

      // Step 5: Remaining instructions must exactly match callback instructions
      const remainingInstructions = instructions.slice(currentIndex)

      if (remainingInstructions.length !== callbackInstructions.length) {
        console.error(`Callback instruction count mismatch. Expected: ${callbackInstructions.length}, Found: ${remainingInstructions.length}`)
        console.error(`Payment instructions end at index ${currentIndex}, total instructions: ${instructions.length}`)
        return false
      }

      // Verify each remaining instruction matches callback instructions exactly
      for (let i = 0; i < remainingInstructions.length; i++) {
        if (!this.instructionsEqual(remainingInstructions[i], callbackInstructions[i])) {
          console.error(`Callback instruction mismatch at index ${i}`)
          console.error('Expected:', this.serializeInstruction(callbackInstructions[i]))
          console.error('Found:', this.serializeInstruction(remainingInstructions[i]))
          return false
        }
      }

      console.log(`✅ All ${callbackInstructions.length} callback instructions verified and match exactly`)
      console.log('Atomic payment verification successful')
      return true

    } catch (error) {
      console.error('Error verifying atomic Solana payment:', error)
      return false
    }
  }

  /**
   * Settle atomic payment (sign with server and submit)
   */
  async settleAtomicPayment(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // First run atomic verification
      const isValid = await this.verifyAtomicPayment(paymentPayload, requirements)
      if (!isValid) {
        return { success: false, error: 'Atomic payment verification failed' }
      }

      // Check if this is a Solana payload
      if (!isSvmPayload(paymentPayload)) {
        return { success: false, error: 'Invalid payment payload: not a Solana transaction' }
      }

      const svmPayload = paymentPayload as ExactSvmPayload

      if (!svmPayload.transaction || typeof svmPayload.transaction !== 'string') {
        return { success: false, error: 'Invalid payment payload: missing or invalid transaction' }
      }

      // Parse the transaction
      const transactionBuffer = Buffer.from(svmPayload.transaction, 'base64')
      let transaction = VersionedTransaction.deserialize(transactionBuffer)

      // Sign transaction with fee payer if configured
      if (this.feePayerKeypair) {
        transaction.sign([this.feePayerKeypair])
        console.log('Transaction signed by facilitator fee payer')
      }

      // Submit the transaction
      console.log('Submitting atomic transaction to Solana network...')
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      })

      // Wait for confirmation
      console.log('Waiting for confirmation...')
      const latestBlockhash = await this.connection.getLatestBlockhash()
      const confirmation = await this.connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      })

      if (confirmation.value.err) {
        console.error('Transaction failed:', confirmation.value.err)
        return {
          success: false,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        }
      }

      console.log('Atomic transaction confirmed:', signature)
      return {
        success: true,
        transactionHash: signature
      }

    } catch (error: any) {
      console.error('Error settling atomic Solana payment:', error)
      return {
        success: false,
        error: error.message || 'Failed to settle atomic payment'
      }
    }
  }
}