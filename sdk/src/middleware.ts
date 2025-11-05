import { Request, Response, NextFunction, RequestHandler } from 'express'
import {
  X402Config,
  X402MiddlewareOptions,
  X402Response,
  PaymentRequirements,
  VerifyRequest,
  X402Version,
  RouteConfig
} from './types'
import { FacilitatorClient } from './facilitator-client'

export class X402Middleware {
  private config: X402Config
  private facilitatorClient: FacilitatorClient
  private options: X402MiddlewareOptions
  private extraCache?: Record<string, any>
  private extraFetched: boolean = false

  constructor(config: X402Config, options: X402MiddlewareOptions = {}) {
    this.config = config
    this.options = {
      bypassOnError: options.bypassOnError ?? false,
      customHeaders: options.customHeaders || {}
    }

    // Initialize facilitator client
    this.facilitatorClient = new FacilitatorClient(config.facilitatorUrl, config.network)
  }

  /**
   * Fetch extra fields from facilitator's supported endpoint
   */
  private async ensureExtraFields(): Promise<void> {
    // Only fetch once
    if (this.extraFetched) {
      return
    }

    this.extraFetched = true

    try {
      const supported = await this.facilitatorClient.getSupported()
      if (supported?.kinds) {
        const networkInfo = supported.kinds.find((k: any) => k.network === this.config.network)
        if (networkInfo?.extra) {
          this.extraCache = networkInfo.extra
        }
      }
    } catch (error) {
      console.error('Failed to fetch extra fields from facilitator:', error)
    }
  }

  /**
   * Create the Express middleware
   */
  middleware(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Find matching route config for this path
      const routeConfig = this.findRouteConfig(req.path)

      if (!routeConfig) {
        // No route configured for this path, continue
        return next()
      }

      // Check if payment header is present
      const paymentHeader = req.headers['x-x402-payment']

      if (!paymentHeader) {
        // No payment provided, return 402 with route-specific requirements
        return await this.send402Response(res, routeConfig)
      }

      try {
        // Parse payment from header (base64 decode if needed)
        let payment: any
        if (typeof paymentHeader === 'string') {
          try {
            // Try to parse as base64 first
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8')
            payment = JSON.parse(decoded)
          } catch {
            // Fall back to direct JSON parse
            payment = JSON.parse(paymentHeader)
          }
        } else {
          payment = paymentHeader
        }

        // Ensure extra fields are fetched before building requirements
        await this.ensureExtraFields()

        // Build payment requirements for this route
        const requirements = this.buildPaymentRequirements(routeConfig)

        // Verify payment
        const verifyRequest: VerifyRequest = {
          x402Version: 1,
          paymentPayload: payment,
          paymentRequirements: requirements
        }

        const verifyResponse = await this.facilitatorClient.verify(verifyRequest)

        if (!verifyResponse.isValid) {
          return await this.send402Response(res, routeConfig, 'Payment verification failed')
        }

        // Call route-specific verification callback
        if (routeConfig.onPaymentVerified) {
          await routeConfig.onPaymentVerified(payment, req)
        }

        // Handle different settlement modes
        if (routeConfig.atomicSettle && routeConfig.onGenerateCallback) {
          // Atomic settlement with callback
          const callback = await routeConfig.onGenerateCallback(payment, req)

          const atomicResponse = await this.facilitatorClient.atomicSettle({
            x402Version: 1,
            paymentPayload: payment,
            paymentRequirements: requirements,
            callback: callback
          })

          if (!atomicResponse.success) {
            return await this.send402Response(res, routeConfig, 'Atomic settlement failed')
          }

          // Call route-specific settlement callback
          if (routeConfig.onPaymentSettled && atomicResponse.settlementTxHash) {
            await routeConfig.onPaymentSettled(payment, atomicResponse.settlementTxHash, req)
          }

          // Add transaction info to request for downstream use
          (req as any).x402 = {
            settlementTxHash: atomicResponse.settlementTxHash,
            callbackTxHash: atomicResponse.callbackTxHash,
            payment: payment,
            route: req.path,
            settled: true,
            atomic: true
          }
        } else if (routeConfig.autoSettle) {
          // Regular auto-settle
          const settleResponse = await this.facilitatorClient.settle({
            x402Version: 1,
            paymentPayload: payment,
            paymentRequirements: requirements
          })

          if (!settleResponse.success) {
            return await this.send402Response(res, routeConfig, 'Payment settlement failed')
          }

          // Call route-specific settlement callback
          if (routeConfig.onPaymentSettled && settleResponse.transactionHash) {
            await routeConfig.onPaymentSettled(payment, settleResponse.transactionHash, req)
          }

          // Add transaction info to request for downstream use
          (req as any).x402 = {
            transactionHash: settleResponse.transactionHash,
            payment: payment,
            route: req.path,
            settled: true,
            atomic: false
          }
        } else {
          // Just verify, no settlement
          (req as any).x402 = {
            payment: payment,
            route: req.path,
            verified: true,
            settled: false,
            atomic: false
          }
        }

        // Payment successful, continue to next middleware
        next()
      } catch (error) {
        console.error('X402 Middleware error:', error)

        // Call global error handler if provided
        if (this.config.onPaymentFailed) {
          await this.config.onPaymentFailed(error as Error, req)
        }

        // Check if we should bypass on error
        if (this.options.bypassOnError) {
          console.warn('Bypassing 402 due to error (bypassOnError=true)')
          return next()
        }

        return await this.send402Response(res, routeConfig, 'Payment processing error')
      }
    }
  }

  /**
   * Find matching route configuration for the given path
   */
  private findRouteConfig(path: string): RouteConfig | null {
    for (const route of this.config.routes) {
      if (route.path instanceof RegExp) {
        if (route.path.test(path)) {
          return route
        }
      } else if (typeof route.path === 'string') {
        // Support wildcards like '/api/premium/*'
        if (route.path.endsWith('/*')) {
          const basePath = route.path.slice(0, -2)
          if (path === basePath || path.startsWith(basePath + '/')) {
            return route
          }
        } else if (path === route.path) {
          return route
        }
      }
    }
    return null
  }

  /**
   * Send 402 Payment Required response with route-specific requirements
   */
  private async send402Response(res: Response, routeConfig: RouteConfig, error?: string): Promise<void> {
    // Ensure extra fields are fetched before building requirements
    await this.ensureExtraFields()

    const requirements = this.buildPaymentRequirements(routeConfig)

    const response: X402Response = {
      x402Version: 1,
      error: error,
      accepts: [requirements]
    }

    // Set custom headers if configured
    Object.entries(this.options.customHeaders || {}).forEach(([key, value]) => {
      res.setHeader(key, value)
    })

    res.status(402).json(response)
  }

  /**
   * Build payment requirements for a specific route
   */
  private buildPaymentRequirements(routeConfig: RouteConfig): PaymentRequirements {
    // Start with route's extra field if defined
    let extra = routeConfig.paymentRequirements.extra || {}

    // Merge with cached extra fields from facilitator
    if (this.extraCache) {
      extra = {
        ...this.extraCache,  // Facilitator's extra fields (feePayer, computeUnitPrice, computeUnitLimit, etc.)
        ...extra             // Route's extra fields override facilitator's if specified
      }
    }

    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: this.config.network,
      maxAmountRequired: routeConfig.paymentRequirements.maxAmountRequired || '1000000',
      resource: routeConfig.paymentRequirements.resource || routeConfig.path.toString(),
      description: routeConfig.paymentRequirements.description || 'API Access',
      mimeType: routeConfig.paymentRequirements.mimeType || 'application/json',
      payTo: routeConfig.paymentRequirements.payTo || this.config.defaultPayTo || '',
      maxTimeoutSeconds: routeConfig.paymentRequirements.maxTimeoutSeconds || 300,
      asset: routeConfig.paymentRequirements.asset || this.getAssetAddress(),
      extra: Object.keys(extra).length > 0 ? extra : undefined
    }

    return requirements
  }

  /**
   * Get asset address based on network
   */
  private getAssetAddress(): string {
    switch (this.config.network) {
      case 'solana':
        return 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mainnet
      case 'solana-devnet':
        return 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' // USDC devnet
      case 'base':
        return '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC on Base
      case 'base-sepolia':
        return '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // USDC on Base Sepolia
      default:
        return ''
    }
  }

  /**
   * Manually verify payment for a specific route
   */
  async verifyPayment(paymentPayload: any, routePath: string): Promise<boolean> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    const requirements = this.buildPaymentRequirements(routeConfig)

    const request: VerifyRequest = {
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements
    }

    const response = await this.facilitatorClient.verify(request)
    return response.isValid
  }

  /**
   * Manually settle payment for a specific route
   */
  async settlePayment(paymentPayload: any, routePath: string): Promise<{ success: boolean; transactionHash?: string }> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    const requirements = this.buildPaymentRequirements(routeConfig)

    const request = {
      x402Version: 1 as X402Version,
      paymentPayload,
      paymentRequirements: requirements
    }

    const response = await this.facilitatorClient.settle(request)

    return {
      success: response.success,
      transactionHash: response.transactionHash
    }
  }

  /**
   * Manual verify and settle for a specific route (non-atomic)
   */
  async verifyAndSettle(paymentPayload: any, routePath: string): Promise<{
    verified: boolean
    settled: boolean
    transactionHash?: string
    error?: string
  }> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    const requirements = this.buildPaymentRequirements(routeConfig)

    const request: VerifyRequest = {
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements
    }

    return await this.facilitatorClient.verifyAndSettle(request)
  }

  /**
   * Atomic settle with callback for a specific route
   * Executes settlement and callback transaction atomically
   */
  async atomicSettle(
    paymentPayload: any,
    routePath: string,
    callbackGenerator?: (payment: any) => Promise<any>
  ): Promise<{
    success: boolean
    settlementTxHash?: string
    callbackTxHash?: string
    error?: string
  }> {
    const routeConfig = this.findRouteConfig(routePath)
    if (!routeConfig) {
      throw new Error(`No route configured for path: ${routePath}`)
    }

    // Use provided callback generator or route's default
    const generateCallback = callbackGenerator || routeConfig.onGenerateCallback
    if (!generateCallback) {
      throw new Error('No callback generator provided for atomic settlement')
    }

    const requirements = this.buildPaymentRequirements(routeConfig)

    // Generate callback transaction
    const callback = await generateCallback(paymentPayload, { path: routePath })

    const response = await this.facilitatorClient.atomicSettle({
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements,
      callback
    })

    return {
      success: response.success,
      settlementTxHash: response.settlementTxHash,
      callbackTxHash: response.callbackTxHash,
      error: response.error
    }
  }

  /**
   * Get the facilitator client for direct use
   */
  getFacilitatorClient(): FacilitatorClient {
    return this.facilitatorClient
  }

  /**
   * Add a new route configuration dynamically
   */
  addRoute(routeConfig: RouteConfig): void {
    this.config.routes.push(routeConfig)
  }

  /**
   * Remove a route configuration by path
   */
  removeRoute(path: string | RegExp): void {
    this.config.routes = this.config.routes.filter(route => route.path !== path)
  }
}

/**
 * Helper function to create middleware with simple configuration
 */
export function createX402Middleware(
  config: X402Config,
  options?: X402MiddlewareOptions
): RequestHandler<any, any, any, any> {
  const x402 = new X402Middleware(config, options)
  return x402.middleware()
}