// Server-side exports
export { X402Middleware } from './middleware'
export { FacilitatorClient } from './facilitator-client'

// Client-side exports
export { X402Client } from './client'
export type { X402ClientConfig, X402PaymentResponse } from './client'

// Utility functions
export {
  serializeInstruction,
  deserializeInstruction,
  serializeInstructions,
  deserializeInstructions
} from './utils'

// Schema builder
export { SchemaBuilder } from './schema'

// Typed routes
export { defineRoute, prop, buildOutputSchema, extractInput } from './route-schema'
export { createTypedRoute, createTypedHandlers } from './typed-routes'
export type { TypedRouteDefinition } from './route-schema'

// Common types
export * from './types'

// Convenience function to create middleware
import { X402Config, X402MiddlewareOptions } from './types'
import { X402Middleware } from './middleware'

export function createX402Middleware(
  config: X402Config,
  options?: X402MiddlewareOptions
) {
  const x402 = new X402Middleware(config, options)
  return x402.middleware()
}