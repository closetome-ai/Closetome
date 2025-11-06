import { X402Client } from '../../solana-sdk/src'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import dotenv from 'dotenv'
import * as readline from 'readline'
import { PropertySchema } from '../../solana-sdk/src/types'

dotenv.config()

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

/**
 * Prompt user for input
 */
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim())
    })
  })
}

/**
 * Parse user input value based on property schema type
 */
function parseInputValue(value: string, schema: PropertySchema): any {
  if (!value) return undefined

  switch (schema.type) {
    case 'number':
      const num = parseFloat(value)
      return isNaN(num) ? undefined : num
    case 'boolean':
      return value === 'true' || value === '1' || value.toLowerCase() === 'yes'
    case 'string':
    default:
      return value
  }
}

/**
 * Collect input from user based on outputSchema
 */
async function collectInputFromSchema(
  inputSchema?: Record<string, PropertySchema>
): Promise<Record<string, any>> {
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return {}
  }

  console.log('\n📝 Please provide input parameters:')
  console.log('   (Press Enter to skip optional parameters)\n')

  const inputs: Record<string, any> = {}

  for (const [key, schema] of Object.entries(inputSchema)) {
    let promptText = `   ${key}`

    if (schema.description) {
      promptText += ` (${schema.description})`
    }

    if (schema.type) {
      promptText += ` [${schema.type}]`
    }

    if (schema.enum) {
      promptText += ` (options: ${schema.enum.join(', ')})`
    }

    const isRequired = schema.required === true
    promptText += isRequired ? ' *required: ' : ': '

    let value: any
    while (true) {
      const answer = await prompt(promptText)

      if (!answer && isRequired) {
        console.log('   ⚠️  This field is required. Please provide a value.')
        continue
      }

      if (!answer) {
        break // Skip optional field
      }

      // Validate enum
      if (schema.enum && !schema.enum.includes(answer)) {
        console.log(`   ⚠️  Invalid value. Must be one of: ${schema.enum.join(', ')}`)
        continue
      }

      value = parseInputValue(answer, schema)
      break
    }

    if (value !== undefined) {
      inputs[key] = value
    }
  }

  return inputs
}

/**
 * Build query string or request body from inputs
 */
function buildRequestParams(
  method: string,
  inputs: Record<string, any>
): { url: string; body?: any } {
  if (method === 'GET') {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(inputs)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value))
      }
    }
    const queryString = params.toString()
    return { url: queryString ? `?${queryString}` : '' }
  } else {
    return { url: '', body: inputs }
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════╗')
  console.log('║  X402 Interactive Atomic Client - Schema-Driven   ║')
  console.log('╚════════════════════════════════════════════════════╝\n')

  // Load payer keypair
  const secretKeyString = process.env.PAYER_SECRET_KEY
  if (!secretKeyString || secretKeyString === 'your_base58_encoded_secret_key_here') {
    console.error('❌ PAYER_SECRET_KEY not configured in .env')
    console.log('   Please set up a test wallet with devnet USDC')
    rl.close()
    process.exit(1)
  }

  let payerKeypair: Keypair
  try {
    const secretKey = bs58.decode(secretKeyString)
    payerKeypair = Keypair.fromSecretKey(secretKey)
    console.log('✅ Payer wallet loaded:', payerKeypair.publicKey.toBase58())
  } catch (error) {
    console.error('❌ Failed to load payer wallet:', error)
    rl.close()
    process.exit(1)
  }

  // Create X402 client
  const client = new X402Client({
    serverUrl: process.env.SERVER_URL || 'http://localhost:4000',
    payerKeypair: payerKeypair,
    network: 'solana-devnet'
  })

  console.log(`\n📡 Server: ${process.env.SERVER_URL || 'http://localhost:4000'}`)
  console.log('🌐 Network: solana-devnet\n')

  try {
    // Step 1: Get initial 402 response to discover input schema
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Step 1: Discover API Schema (Initial 402 Request)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const endpoint = '/api/atomic/premium'
    console.log(`🔍 Requesting: ${endpoint}`)

    const initialRequirements = await client.getPaymentRequirements(endpoint)
    if (!initialRequirements) {
      console.log('❌ No payment required or endpoint not found')
      rl.close()
      return
    }

    console.log('✅ Received 402 Payment Required')

    // Check if outputSchema exists
    if (!initialRequirements.outputSchema) {
      console.log('⚠️  No outputSchema found. Using default payment flow...')
      rl.close()
      return
    }

    const inputSchema = initialRequirements.outputSchema.input
    const method = inputSchema.method || 'GET'

    console.log('\n📋 API Information:')
    console.log(`   Method: ${method}`)
    console.log(`   Discoverable: ${inputSchema.discoverable ?? true}`)

    if (inputSchema.properties && Object.keys(inputSchema.properties).length > 0) {
      console.log(`   Input Parameters: ${Object.keys(inputSchema.properties).length}`)
    }

    // Step 2: Collect user inputs based on schema
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Step 2: Collect Input Parameters')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    const userInputs = await collectInputFromSchema(inputSchema.properties)

    console.log('\n✅ Input collected:')
    console.log(JSON.stringify(userInputs, null, 2))

    // Step 3: Make second 402 request with user inputs to get final requirements
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Step 3: Get Final Payment Requirements')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const { url: queryString, body } = buildRequestParams(method, userInputs)
    const finalEndpoint = `${endpoint}${queryString}`

    console.log(`🔍 Requesting with params: ${finalEndpoint}`)
    if (body) {
      console.log(`   Body: ${JSON.stringify(body)}`)
    }

    // For GET requests, pass query string in endpoint
    // For POST requests, we'll need to enhance the getPaymentRequirements to accept body
    const finalRequirements = method === 'GET'
      ? await client.getPaymentRequirements(finalEndpoint)
      : await client.getPaymentRequirements(endpoint) // TODO: need to support POST body

    if (!finalRequirements) {
      console.log('❌ Failed to get final payment requirements')
      rl.close()
      return
    }

    console.log('✅ Received final 402 response')
    console.log('\n📋 Payment Requirements:')
    console.log('   Network:', finalRequirements.network)
    console.log('   Amount:', finalRequirements.maxAmountRequired, `(${parseInt(finalRequirements.maxAmountRequired) / 1_000_000} USDC)`)
    console.log('   Pay to:', finalRequirements.payTo)
    console.log('   Description:', finalRequirements.description)

    if (finalRequirements.extra?.callbackInstructions) {
      console.log(`   Callback Instructions: ${finalRequirements.extra.callbackInstructions.length} instruction(s)`)
    }

    // Step 4: Execute atomic payment
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Step 4: Execute Atomic Payment')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const confirmPrompt = await prompt('💳 Proceed with payment? (yes/no): ')
    if (confirmPrompt.toLowerCase() !== 'yes' && confirmPrompt.toLowerCase() !== 'y') {
      console.log('❌ Payment cancelled by user')
      rl.close()
      return
    }

    console.log('\n💳 Creating atomic payment transaction...')

    const requestOptions: any = { method }
    if (method !== 'GET' && body) {
      requestOptions.body = JSON.stringify(body)
      requestOptions.headers = { 'Content-Type': 'application/json' }
    }

    const result = await client.requestWithAtomicPayment(finalEndpoint, requestOptions)

    console.log('\n✅ Atomic payment successful!')
    console.log('\n📦 Response:')
    console.log(JSON.stringify(result, null, 2))

    if (result.payment?.settlementTxHash || result.payment?.transactionHash) {
      const txHash = result.payment.settlementTxHash || result.payment.transactionHash
      const explorerUrl = `https://explorer.solana.com/tx/${txHash}?cluster=devnet`
      console.log('\n🔗 View on Solana Explorer:')
      console.log(`   ${explorerUrl}`)
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ All steps completed successfully!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('ℹ️  Flow Summary:')
    console.log('   1. Discovered API schema from initial 402 response')
    console.log('   2. Collected user inputs based on schema definition')
    console.log('   3. Got final payment requirements with user params')
    console.log('   4. Executed atomic payment transaction')
    console.log('   • Payment and callback executed atomically')
    console.log('   • Single transaction on Solana blockchain\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.response?.data) {
      console.error('Response:', error.response.data)
    }
  } finally {
    rl.close()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  rl.close()
  process.exit(1)
})
