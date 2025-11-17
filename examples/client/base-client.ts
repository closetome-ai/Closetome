import { X402Client } from '../../sdk/src'
import { ethers } from 'ethers'
import * as readline from 'readline'
import { config } from 'dotenv'
import path from 'path'

// =============================================================================
// BASE CHAIN X402 CLIENT EXAMPLE
// =============================================================================
// This example demonstrates making X402 payments on Base chain (EVM)
//
// IMPORTANT: This client uses Base Sepolia testnet
// Make sure you have test USDC on Base Sepolia
// =============================================================================

config({
  path: path.join(__dirname, '../.env'),
})
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const prompt = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer)
    })
  })
}

// Format USDC amount (6 decimals) to human readable
function formatUSDC(amount: string): string {
  const num = parseFloat(amount) / 1_000_000
  return num.toFixed(6)
}

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('🟦 BASE CHAIN X402 CLIENT')
  console.log('='.repeat(80) + '\n')

  // =============================================================================
  // CONFIGURATION
  // =============================================================================

  const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4001'

  // Load EVM private key from environment or prompt
  let privateKey = process.env.EVM_PRIVATE_KEY

  if (!privateKey) {
    console.log('⚠️  No EVM_PRIVATE_KEY found in environment')
    privateKey = await prompt('Please enter your EVM private key (with or without 0x prefix): ')
  }

  // Validate and clean private key
  if (!privateKey.startsWith('0x')) {
    privateKey = '0x' + privateKey
  }

  let userAddress: string
  try {
    // Validate private key format
    const wallet = new ethers.Wallet(privateKey)
    userAddress = wallet.address
    console.log(`✅ EVM Wallet Address: ${userAddress}\n`)
  } catch (error) {
    console.error('❌ Invalid EVM private key format')
    rl.close()
    process.exit(1)
  }

  // =============================================================================
  // INITIALIZE CLIENT
  // =============================================================================

  console.log('🔧 Initializing X402 Client for Base chain...\n')

  const client = new X402Client({
    serverUrl: SERVER_URL,
    wallet: {
      evm: {
        privateKey: privateKey
      }
    }
  })

  console.log('📊 Wallet Info:', client.getWalletInfo())
  console.log('')

  // =============================================================================
  // TEST 1: PUBLIC ENDPOINT (No payment required)
  // =============================================================================

  console.log('📋 Test 1: Calling public endpoint (no payment)...\n')

  try {
    const publicResponse = await client.requestWithPayment('/api/public/info')
    console.log('✅ Public endpoint response:')
    console.log(JSON.stringify(publicResponse, null, 2))
    console.log('')
  } catch (error: any) {
    console.error('❌ Error calling public endpoint:', error.message)
  }

  // =============================================================================
  // TEST 2: STANDARD PROTECTED ENDPOINT
  // =============================================================================

  const runStandardTest = await prompt('\n🔹 Test 2: Call standard protected endpoint? (y/n): ')

  if (runStandardTest.toLowerCase() === 'y') {
    try {
      // Get payment requirements first
      console.log('\n📡 Getting payment requirements...')
      const requirements = await client.getPaymentRequirements('/api/standard/protected')

      if (requirements) {
        const amount = formatUSDC(requirements.maxAmountRequired)
        console.log(`\n💳 Payment Required:`)
        console.log(`   Amount: ${amount} USDC`)
        console.log(`   Network: ${requirements.network}`)
        console.log(`   Recipient: ${requirements.payTo}`)
        console.log(`   Description: ${requirements.description}\n`)

        console.log('💸 Making payment...')
        const response = await client.requestWithPayment('/api/standard/protected')

        console.log('\n✅ Payment successful! Response:')
        console.log(JSON.stringify(response, null, 2))
        console.log('')
      }
    } catch (error: any) {
      if (error.response?.status === 402) {
        console.error('❌ Payment required but failed:', error.response.data)
      } else {
        console.error('❌ Error:', error.message)
      }
    }
  }

  // =============================================================================
  // TEST 3: PREMIUM ENDPOINT WITH TIER SELECTION
  // =============================================================================

  const runPremiumTest = await prompt('\n🔹 Test 3: Call premium endpoint with tier selection? (y/n): ')

  if (runPremiumTest.toLowerCase() === 'y') {
    // First get payment requirements for each tier to show accurate pricing
    console.log('\n📊 Fetching tier information...\n')

    const tiers = ['basic', 'premium', 'enterprise']
    const tierInfo: Record<string, any> = {}

    for (const tier of tiers) {
      try {
        const req = await client.getPaymentRequirements('/api/premium', { tier })
        if (req) {
          tierInfo[tier] = {
            amount: formatUSDC(req.maxAmountRequired),
            description: req.description
          }
        }
      } catch (e) {
        // Ignore errors during tier info fetching
      }
    }

    console.log('Available tiers:')
    tiers.forEach((tier, index) => {
      const info = tierInfo[tier]
      if (info) {
        console.log(`  ${index + 1}. ${tier.padEnd(12)} - ${info.amount} USDC`)
        console.log(`     ${info.description}`)
      } else {
        console.log(`  ${index + 1}. ${tier}`)
      }
    })

    const tierChoice = await prompt('\nSelect tier (1-3): ')
    const tierIndex = parseInt(tierChoice) - 1

    if (tierIndex >= 0 && tierIndex < tiers.length) {
      const tier = tiers[tierIndex]

      try {
        // Get exact payment requirements for selected tier
        console.log(`\n📡 Getting payment requirements for ${tier} tier...`)
        const requirements = await client.getPaymentRequirements('/api/premium', { tier })

        if (requirements) {
          const amount = formatUSDC(requirements.maxAmountRequired)
          console.log(`\n💳 Payment Required:`)
          console.log(`   Tier: ${tier}`)
          console.log(`   Amount: ${amount} USDC`)
          console.log(`   Network: ${requirements.network}`)
          console.log(`   Recipient: ${requirements.payTo}`)
          console.log(`   Description: ${requirements.description}\n`)

          console.log('💸 Making payment...')
          const response = await client.requestWithPayment('/api/premium', {
            params: { tier }
          })

          console.log('\n✅ Payment successful! Response:')
          console.log(JSON.stringify(response, null, 2))
          console.log('')
        }
      } catch (error: any) {
        if (error.response?.status === 402) {
          console.error('❌ Payment required but failed:', error.response.data)
        } else {
          console.error('❌ Error:', error.message)
        }
      }
    } else {
      console.log('❌ Invalid tier selection')
    }
  }

  // =============================================================================
  // DONE
  // =============================================================================

  console.log('\n' + '='.repeat(80))
  console.log('✨ All tests completed!')
  console.log('='.repeat(80) + '\n')

  console.log('💡 Notes:')
  console.log('  - All payments use EIP-3009 transferWithAuthorization (gasless for you)')
  console.log('  - Facilitator pays the gas fees')
  console.log('  - Check your wallet USDC balance to see payments')
  console.log('  - Standard endpoint: verify + settle (2 steps)')
  console.log('  - Premium endpoint: atomic verify + settle + NFT mint (1 transaction)')
  console.log('')

  rl.close()
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error)
  rl.close()
  process.exit(1)
})
