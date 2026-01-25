import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { Pumpfun, PUMPFUN_PROGRAM_ID } from './pumpfun.js'
import { PumpAMM, PUMPAMM_PROGRAM_ID } from './pumpamm.js'
import type { BuyTokenParams, SellTokenParams, DexType, TradeResult } from './types.js'

export { Pumpfun, PUMPFUN_PROGRAM_ID } from './pumpfun.js'
export { PumpAMM, PUMPAMM_PROGRAM_ID } from './pumpamm.js'
export type { BuyTokenParams, SellTokenParams, DexType, TradeResult } from './types.js'

/**
 * Unified trading interface that automatically selects Pumpfun or PumpAMM
 * based on whether the token has graduated to AMM
 */
export class PumpTrader {
  private pumpfun: Pumpfun
  private pumpamm: PumpAMM
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
    this.pumpfun = new Pumpfun(connection)
    this.pumpamm = new PumpAMM(connection)
  }

  /**
   * Detect which DEX to use for a token
   * - If bonding curve is complete (graduated), use PumpAMM
   * - Otherwise use Pumpfun bonding curve
   */
  async detectDex(mint: PublicKey): Promise<DexType> {
    // First check if AMM pool exists
    const ammPoolExists = await this.pumpamm.poolExists(mint)
    if (ammPoolExists) {
      return 'pumpamm'
    }

    // Check if bonding curve exists and is not complete
    const bondingCurveInfo = await this.pumpfun.getBondingCurveInfo(mint)
    if (bondingCurveInfo && !bondingCurveInfo.complete) {
      return 'pumpfun'
    }

    // If bonding curve is complete but no AMM pool, it's in transition
    // Default to AMM as it will likely be available soon
    if (bondingCurveInfo?.complete) {
      return 'pumpamm'
    }

    throw new Error('Token not found on Pumpfun or PumpAMM')
  }

  /**
   * Create buy instructions, automatically selecting the right DEX
   */
  async createBuyInstructions(params: BuyTokenParams): Promise<TradeResult> {
    const dexType = await this.detectDex(params.mint)

    let instructions: TransactionInstruction[]
    if (dexType === 'pumpfun') {
      instructions = await this.pumpfun.createBuyInstruction(params)
    } else {
      instructions = await this.pumpamm.createBuyInstruction(params)
    }

    return { instructions, dexType }
  }

  /**
   * Create sell instructions, automatically selecting the right DEX
   */
  async createSellInstructions(params: SellTokenParams): Promise<TradeResult> {
    const dexType = await this.detectDex(params.mint)

    let instructions: TransactionInstruction[]
    if (dexType === 'pumpfun') {
      instructions = await this.pumpfun.createSellInstruction(params)
    } else {
      instructions = await this.pumpamm.createSellInstruction(params)
    }

    return { instructions, dexType }
  }
}
