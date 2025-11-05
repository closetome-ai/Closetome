import axios, { AxiosInstance } from 'axios'
import {
  VerifyRequest,
  VerifyResponse,
  SettleRequest,
  SettleResponse,
  AtomicSettleRequest,
  AtomicSettleResponse,
} from './types'

export class FacilitatorClient {
  private client: AxiosInstance

  constructor(facilitatorUrl: string) {
    this.client = axios.create({
      baseURL: facilitatorUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }

  /**
   * Get supported payment kinds from the facilitator
   */
  async getSupported() {
    const response = await this.client.get('/supported')
    return response.data
  }

  /**
   * Verify a payment with the facilitator
   */
  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    try {
      const response = await this.client.post<VerifyResponse>('/verify', request)
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        return error.response.data
      }
      throw error
    }
  }

  /**
   * Settle a payment with the facilitator
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    try {
      const response = await this.client.post<SettleResponse>('/settle', request)
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        return error.response.data
      }
      throw error
    }
  }

  /**
   * Sequential verify and settle (non-atomic)
   * Verifies first, then settles if valid
   */
  async verifyAndSettle(request: VerifyRequest): Promise<{
    verified: boolean
    settled: boolean
    transactionHash?: string
    error?: string
  }> {
    // First verify
    const verifyResult = await this.verify(request)

    if (!verifyResult.isValid) {
      return {
        verified: false,
        settled: false,
        error: verifyResult.error || 'Verification failed'
      }
    }

    // Then settle
    const settleRequest: SettleRequest = {
      x402Version: request.x402Version,
      paymentPayload: request.paymentPayload,
      paymentRequirements: request.paymentRequirements
    }

    const settleResult = await this.settle(settleRequest)

    return {
      verified: true,
      settled: settleResult.success,
      transactionHash: settleResult.transactionHash,
      error: settleResult.error
    }
  }

  /**
   * Atomic settle with callback transaction
   * Settles payment and executes callback in a single atomic operation
   * The callback transaction is executed atomically with the settlement
   *
   * @param request - Atomic settle request including payment and callback transaction
   * @returns Response with settlement and callback transaction hashes
   */
  async atomicSettle(request: AtomicSettleRequest): Promise<AtomicSettleResponse> {
    try {
      // TODO: Update endpoint path when facilitator implements atomic settle
      const response = await this.client.post<AtomicSettleResponse>('/atomic-settle', request)
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        return error.response.data
      }

      // Facilitator doesn't support atomic settle yet
      console.warn('Atomic settle not yet supported by facilitator')
      return {
        success: false,
        error: 'Atomic settle not yet implemented in facilitator'
      }
    }
  }
}