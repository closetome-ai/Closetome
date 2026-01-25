import {
  PublicKey,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js'
import { Program, Idl } from '@coral-xyz/anchor'
import {
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token'
import { createATAInstruction, createWsolAccountInstructions } from '../utils/solana.js'
import { struct, u16, u8 } from '@solana/buffer-layout'
import { publicKey, u64 } from '@solana/buffer-layout-utils'
import type { BuyTokenParams, SellTokenParams } from './types.js'
import { PUMPFUN_PROGRAM_ID } from './pumpfun.js'
import PUMPAMM_IDL from './pumpamm.idl.json' with { type: 'json' }

export const PUMPAMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')

interface PoolLayout {
  poolBump: number
  index: number
  creator: PublicKey
  baseMint: PublicKey
  quoteMint: PublicKey
  lpMint: PublicKey
  poolBaseTokenAccount: PublicKey
  poolQuoteTokenAccount: PublicKey
  lpSupply: bigint
  coinCreator: PublicKey
}

const PoolLayoutStruct = struct<PoolLayout>([
  u8('poolBump'),
  u16('index'),
  publicKey('creator'),
  publicKey('baseMint'),
  publicKey('quoteMint'),
  publicKey('lpMint'),
  publicKey('poolBaseTokenAccount'),
  publicKey('poolQuoteTokenAccount'),
  u64('lpSupply'),
  publicKey('coinCreator'),
])

export function findAuthorityPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([
    Buffer.from('pool-authority'),
    mint.toBuffer(),
  ], PUMPFUN_PROGRAM_ID)
}

export function findCreatorVaultPDA(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([
    Buffer.from('creator_vault'),
    creator.toBuffer(),
  ], PUMPAMM_PROGRAM_ID)
}

export function findPoolPDA(mint: PublicKey): [PublicKey, number] {
  const [authority] = findAuthorityPDA(mint)
  return PublicKey.findProgramAddressSync([
    Buffer.from('pool'),
    Buffer.from([0, 0]),
    authority.toBuffer(),
    mint.toBuffer(),
    NATIVE_MINT.toBuffer(),
  ], PUMPAMM_PROGRAM_ID)
}

export class PumpAMM {
  private program: Program<Idl>
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection

    const mockWallet: any = {
      publicKey: PUMPAMM_PROGRAM_ID,
      signTransaction: async () => { throw new Error('Not implemented') },
      signAllTransactions: async () => { throw new Error('Not implemented') }
    }

    const provider: any = {
      connection,
      wallet: mockWallet,
      opts: { preflightCommitment: 'processed', commitment: 'processed' }
    }

    this.program = new Program(PUMPAMM_IDL as Idl, provider)
  }

  async getPoolInfo(mint: PublicKey): Promise<PoolLayout | null> {
    const [pool] = findPoolPDA(mint)
    const info = await this.connection.getAccountInfo(pool)
    if (!info) return null
    return PoolLayoutStruct.decode(info.data.slice(8))
  }

  async poolExists(mint: PublicKey): Promise<boolean> {
    const info = await this.getPoolInfo(mint)
    return info !== null
  }

  async createBuyInstruction(params: BuyTokenParams): Promise<TransactionInstruction[]> {
    const { mint, amount, maxLamports, user, destination } = params
    const instructions: TransactionInstruction[] = []

    // Get PDAs
    const [pool] = findPoolPDA(mint)
    const poolBaseTokenAccount = await getAssociatedTokenAddress(mint, pool, true)
    const poolQuoteTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, pool, true)

    // Get creator from pool
    const poolInfo = await this.connection.getAccountInfo(pool)
    if (!poolInfo) {
      throw new Error('Pool not found')
    }
    const creator = PoolLayoutStruct.decode(poolInfo.data.slice(8)).coinCreator

    const [creatorVault] = findCreatorVaultPDA(creator)
    const creatorVaultTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, creatorVault, true)

    // Fee recipient
    const feeRecipient = new PublicKey('7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX')
    const feeRecipientTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, feeRecipient, true)

    // Create ATA for destination (or user)
    const recipient = destination || user
    const { instructions: ataInstructions, ataAddress } = await createATAInstruction(
      user,
      recipient,
      mint
    )
    instructions.push(...ataInstructions)

    // Create wSOL account
    const { instructions: wsolInstructions, wsolAccountAddress } = await createWsolAccountInstructions(
      user,
      maxLamports.toNumber()
    )
    instructions.push(...wsolInstructions)

    // Build buy instruction
    const buyInstruction = await this.program.methods
      .buy(amount, maxLamports)
      .accounts({
        pool,
        user,
        globalConfig: new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw'),
        baseMint: mint,
        quoteMint: NATIVE_MINT,
        userBaseTokenAccount: ataAddress,
        userQuoteTokenAccount: wsolAccountAddress,
        poolBaseTokenAccount,
        poolQuoteTokenAccount,
        protocolFeeRecipient: feeRecipient,
        protocolFeeRecipientTokenAccount: feeRecipientTokenAccount,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        event_authority: new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR'),
        program: PUMPAMM_PROGRAM_ID,
        coinCreatorVaultAta: creatorVaultTokenAccount,
        coinCreatorVaultAuthority: creatorVault,
      })
      .instruction()
    instructions.push(buyInstruction)

    // Close wSOL account to recover remaining lamports
    instructions.push(
      createCloseAccountInstruction(
        wsolAccountAddress,
        user,
        user,
      )
    )

    return instructions
  }

  async createSellInstruction(params: SellTokenParams): Promise<TransactionInstruction[]> {
    const { mint, inputAmount, minOutputAmount, user, destination } = params
    const instructions: TransactionInstruction[] = []

    // Get PDAs
    const [pool] = findPoolPDA(mint)
    const poolBaseTokenAccount = await getAssociatedTokenAddress(mint, pool, true)
    const poolQuoteTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, pool, true)

    // Get creator from pool
    const poolInfo = await this.connection.getAccountInfo(pool)
    if (!poolInfo) {
      throw new Error('Pool not found')
    }
    const creator = PoolLayoutStruct.decode(poolInfo.data.slice(8)).coinCreator

    const [creatorVault] = findCreatorVaultPDA(creator)
    const creatorVaultTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, creatorVault, true)

    // Fee recipient
    const feeRecipient = new PublicKey('7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX')
    const feeRecipientTokenAccount = await getAssociatedTokenAddress(NATIVE_MINT, feeRecipient, true)

    const ataAddress = await getAssociatedTokenAddress(mint, user)

    // Create wSOL account
    const { instructions: wsolInstructions, wsolAccountAddress } = await createWsolAccountInstructions(
      user,
      0,
      destination
    )
    instructions.push(...wsolInstructions)

    // Build sell instruction
    const sellInstruction = await this.program.methods
      .sell(inputAmount, minOutputAmount)
      .accounts({
        pool,
        user,
        globalConfig: new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw'),
        baseMint: mint,
        quoteMint: NATIVE_MINT,
        userBaseTokenAccount: ataAddress,
        userQuoteTokenAccount: wsolAccountAddress,
        poolBaseTokenAccount,
        poolQuoteTokenAccount,
        protocolFeeRecipient: feeRecipient,
        protocolFeeRecipientTokenAccount: feeRecipientTokenAccount,
        baseTokenProgram: TOKEN_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        event_authority: new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR'),
        program: PUMPAMM_PROGRAM_ID,
        coinCreatorVaultAta: creatorVaultTokenAccount,
        coinCreatorVaultAuthority: creatorVault,
      })
      .instruction()
    instructions.push(sellInstruction)

    // Close wSOL account
    instructions.push(
      createCloseAccountInstruction(
        wsolAccountAddress,
        destination || user,
        destination || user,
      )
    )

    return instructions
  }
}
