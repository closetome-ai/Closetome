import { Request, Response } from 'express'
import { OutputSchema, PropertySchema, RoutePaymentRequirements, CallbackTransaction, PaymentPayload } from './types'

/**
 * Simple schema definition with direct TypeScript types
 */
export interface TypedRouteDefinition<TInput = any, TOutput = any> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string | RegExp
  atomic?: boolean
  autoSettle?: boolean
  discoverable?: boolean

  // Schema definitions for documentation
  inputSchema?: Record<string, PropertySchema>
  outputSchema?: Record<string, PropertySchema>

  // Payment requirements generator with typed input
  paymentRequirements: (params: {
    input: TInput
    req: Request
  }) => Promise<RoutePaymentRequirements> | RoutePaymentRequirements

  // Optional callback generator for atomic operations
  onGenerateCallback?: (payment: PaymentPayload, req: Request) => Promise<CallbackTransaction>

  // Typed handler
  handler: (params: {
    input: TInput
    req: Request
    res: Response
  }) => Promise<TOutput> | TOutput
}

/**
 * Convert PropertySchema record to OutputSchema
 */
export function buildOutputSchema(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  inputSchema?: Record<string, PropertySchema>,
  outputSchema?: Record<string, PropertySchema>,
  discoverable?: boolean
): OutputSchema {
  return {
    input: {
      type: 'http',
      method,
      discoverable: discoverable ?? true,
      properties: inputSchema
    },
    output: {
      type: 'http',
      properties: outputSchema
    }
  }
}

/**
 * Extract input from request based on method
 */
export function extractInput<T = any>(
  req: Request,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
): T {
  const source = method === 'GET' ? req.query : req.body
  return source as T
}

/**
 * Helper to create a typed route definition
 */
export function defineRoute<TInput = any, TOutput = any>(
  definition: TypedRouteDefinition<TInput, TOutput>
): TypedRouteDefinition<TInput, TOutput> {
  return definition
}

/**
 * Schema property builders for documentation
 */
export const prop = {
  string: (description?: string, options?: { enum?: string[] }): PropertySchema => ({
    type: 'string',
    description,
    ...(options?.enum && { enum: options.enum })
  }),

  number: (description?: string): PropertySchema => ({
    type: 'number',
    description
  }),

  boolean: (description?: string): PropertySchema => ({
    type: 'boolean',
    description
  }),

  object: (properties: Record<string, PropertySchema>, description?: string): PropertySchema => ({
    type: 'object',
    description,
    properties
  }),

  array: (items: PropertySchema, description?: string): PropertySchema => ({
    type: 'array',
    description,
    items
  })
}
