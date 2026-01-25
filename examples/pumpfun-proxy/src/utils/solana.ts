import {
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  Connection,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress
} from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import bs58 from 'bs58'

// Create ATA instruction
export const createATAInstruction = async (
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
) => {
  const ataAddress = await getAssociatedTokenAddress(
    mint,
    owner,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  return {
    instructions: [createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ataAddress,
      owner,
      mint,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )],
    ataAddress,
  }
}

// Priority fee instructions
export const createPriorityFeeInstruction = (
  priorityFeeInMicroLamports: bigint = 1000000n,
  computeLimit: number = 150000,
) => {
  const priorityLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeLimit,
  })
  const priorityFeeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFeeInMicroLamports
  })

  return [priorityLimitInstruction, priorityFeeInstruction]
}

// Create wSOL account instructions
export const createWsolAccountInstructions = async (
  payer: PublicKey,
  lamports: number,
  owner?: PublicKey,
) => {
  const instructions: TransactionInstruction[] = []
  const wsolSeed = `wsol-${Date.now()}`
  const wsolAccountAddress = await PublicKey.createWithSeed(
    owner || payer,
    wsolSeed,
    TOKEN_PROGRAM_ID
  )

  const rentExemptBalance = 2039280

  instructions.push(
    SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      basePubkey: owner || payer,
      seed: wsolSeed,
      newAccountPubkey: wsolAccountAddress,
      lamports: rentExemptBalance + lamports,
      space: 165,
      programId: TOKEN_PROGRAM_ID
    })
  )

  instructions.push(
    new TransactionInstruction({
      keys: [
        { pubkey: wsolAccountAddress, isSigner: false, isWritable: true },
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
        { pubkey: owner || payer, isSigner: true, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
      ],
      programId: TOKEN_PROGRAM_ID,
      data: Buffer.from([1, 0, 0, 0])
    })
  )

  return {
    instructions,
    wsolAccountAddress,
  }
}

// Create Keypair from bs58 private key
export const createKeypairFromPrivateKey = (privateKeyString: string): Keypair => {
  return Keypair.fromSecretKey(bs58.decode(privateKeyString))
}

// Slippage calculation
export const calculateSlippage = (
  params: {
    price: number
    input?: BN
    output?: BN
    slippageBps: number
    side: 'buy' | 'sell'
    decimals: number
  }
): BN => {
  const { price, input, output, slippageBps: slippageBasisPoints, side, decimals } = params

  if ((!input && !output) || (input && output)) {
    throw new Error('Must provide either input or output, not both')
  }

  const SOL_PRICE_SCALE_FACTOR = new BN(1_000_000_000)
  const scaledPrice = new BN(Math.round(price * SOL_PRICE_SCALE_FACTOR.toNumber()))

  if (scaledPrice.isZero()) {
    throw new Error('Price cannot be zero')
  }

  const tokenDecimalsFactor = new BN(10).pow(new BN(decimals))
  const slippageBN = new BN(slippageBasisPoints)
  const TEN_THOUSAND = new BN(10000)

  if (input) {
    let expectedOutput: BN
    let minOutput: BN

    if (side === 'buy') {
      expectedOutput = input.mul(tokenDecimalsFactor).div(scaledPrice)
      minOutput = expectedOutput.mul(TEN_THOUSAND.sub(slippageBN)).div(TEN_THOUSAND)
    } else {
      expectedOutput = input.mul(scaledPrice).div(tokenDecimalsFactor)
      minOutput = expectedOutput.mul(TEN_THOUSAND.sub(slippageBN)).div(TEN_THOUSAND)
    }
    return minOutput
  } else if (output) {
    let expectedInput: BN
    let maxInput: BN

    if (side === 'buy') {
      expectedInput = output.mul(scaledPrice).div(tokenDecimalsFactor)
      maxInput = expectedInput.mul(TEN_THOUSAND.add(slippageBN)).div(TEN_THOUSAND)
    } else {
      expectedInput = output.mul(tokenDecimalsFactor).div(scaledPrice)
      maxInput = expectedInput.mul(TEN_THOUSAND.add(slippageBN)).div(TEN_THOUSAND)
    }
    return maxInput
  }

  throw new Error('Invalid parameters')
}
