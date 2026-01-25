import {
  PublicKey,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js'
import { Program, Idl } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { createATAInstruction } from '../utils/solana.js'
import { struct } from '@solana/buffer-layout'
import { bool, publicKey, u64 } from '@solana/buffer-layout-utils'
import type { BuyTokenParams, SellTokenParams } from './types.js'
import PUMPFUN_IDL from './pumpfun.idl.json' with { type: 'json' }

export const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')

const GLOBAL_ACCOUNT_SEED = 'global'
const BONDING_CURVE_SEED = 'bonding-curve'
const CREATOR_VAULT_SEED = 'creator-vault'

interface BondingCurveLayout {
  virtualTokenReserves: bigint
  virtualSolReserves: bigint
  realTokenReserves: bigint
  realSolReserves: bigint
  tokenTotalSupply: bigint
  complete: boolean
  creator: PublicKey
}

const BondingCurveLayoutStruct = struct<BondingCurveLayout>([
  u64('virtualTokenReserves'),
  u64('virtualSolReserves'),
  u64('realTokenReserves'),
  u64('realSolReserves'),
  u64('tokenTotalSupply'),
  bool('complete'),
  publicKey('creator'),
])

export function findGlobalAccountPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_ACCOUNT_SEED)],
    PUMPFUN_PROGRAM_ID
  )
}

export function findBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID
  )
}

export function findCreatorVaultPDA(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CREATOR_VAULT_SEED), creator.toBuffer()],
    PUMPFUN_PROGRAM_ID
  )
}

export class Pumpfun {
  private program: Program<Idl>
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection

    const mockWallet: any = {
      publicKey: PUMPFUN_PROGRAM_ID,
      signTransaction: async () => { throw new Error('Not implemented') },
      signAllTransactions: async () => { throw new Error('Not implemented') }
    }

    const provider: any = {
      connection,
      wallet: mockWallet,
      opts: { preflightCommitment: 'processed', commitment: 'processed' }
    }

    this.program = new Program(PUMPFUN_IDL as Idl, provider)
  }

  async getBondingCurveInfo(mint: PublicKey): Promise<BondingCurveLayout | null> {
    const [bondingCurve] = findBondingCurvePDA(mint)
    const info = await this.connection.getAccountInfo(bondingCurve)
    if (!info) return null
    return BondingCurveLayoutStruct.decode(info.data.slice(8))
  }

  async isComplete(mint: PublicKey): Promise<boolean> {
    const info = await this.getBondingCurveInfo(mint)
    return info?.complete ?? true
  }

  async createBuyInstruction(params: BuyTokenParams): Promise<TransactionInstruction[]> {
    const { mint, amount, maxLamports, user, destination } = params
    const instructions: TransactionInstruction[] = []

    // Create ATA for destination (or user)
    const recipient = destination || user
    const { instructions: ataInstructions, ataAddress } = await createATAInstruction(
      user,
      recipient,
      mint
    )
    instructions.push(...ataInstructions)

    // Get PDAs
    const [globalAccount] = findGlobalAccountPDA()
    const [bondingCurve] = findBondingCurvePDA(mint)

    // Get creator from bonding curve
    const bondingCurveInfo = await this.connection.getAccountInfo(bondingCurve)
    if (!bondingCurveInfo) {
      throw new Error('Bonding curve not found - token may have graduated to AMM')
    }
    const creator = BondingCurveLayoutStruct.decode(bondingCurveInfo.data.slice(8)).creator

    const [creatorVault] = findCreatorVaultPDA(creator)
    const associatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurve, true)
    const feeRecipient = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM')

    const buyInstruction = await this.program.methods
      .buy(amount, maxLamports)
      .accounts({
        global: globalAccount,
        feeRecipient: feeRecipient,
        mint: mint,
        bondingCurve: bondingCurve,
        associatedBondingCurve: associatedBondingCurve,
        associatedUser: ataAddress,
        user: user,
        creatorVault,
      })
      .instruction()
    instructions.push(buyInstruction)

    return instructions
  }

  async createSellInstruction(params: SellTokenParams): Promise<TransactionInstruction[]> {
    const { mint, inputAmount, minOutputAmount, user } = params
    const instructions: TransactionInstruction[] = []

    // Get PDAs
    const [globalAccount] = findGlobalAccountPDA()
    const [bondingCurve] = findBondingCurvePDA(mint)

    // Get creator from bonding curve
    const bondingCurveInfo = await this.connection.getAccountInfo(bondingCurve)
    if (!bondingCurveInfo) {
      throw new Error('Bonding curve not found')
    }
    const creator = BondingCurveLayoutStruct.decode(bondingCurveInfo.data.slice(8)).creator

    const [creatorVault] = findCreatorVaultPDA(creator)
    const associatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurve, true)
    const associatedUser = await getAssociatedTokenAddress(mint, user, false)
    const feeRecipient = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM')

    const sellInstruction = await this.program.methods
      .sell(inputAmount, minOutputAmount)
      .accounts({
        global: globalAccount,
        feeRecipient: feeRecipient,
        mint: mint,
        bondingCurve: bondingCurve,
        associatedBondingCurve: associatedBondingCurve,
        associatedUser: associatedUser,
        user,
        creatorVault,
      })
      .instruction()
    instructions.push(sellInstruction)

    return instructions
  }
}
