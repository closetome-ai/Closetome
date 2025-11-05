import { Keypair } from '@solana/web3.js'
import { X402Client } from '../../solana-sdk/src'
import bs58 from 'bs58'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({
  path: path.join(__dirname, '.env'),
})

async function main() {
  // Load payer keypair from environment
  const secretKeyString = process.env.PAYER_SECRET_KEY
  if (!secretKeyString) {
    console.error('❌ PAYER_SECRET_KEY not found in environment')
    process.exit(1)
  }

  const secretKey = bs58.decode(secretKeyString)
  const payerKeypair = Keypair.fromSecretKey(secretKey)

  console.log('✅ Payer wallet loaded:', payerKeypair.publicKey.toBase58())

  // Create X402 client
  const client = new X402Client({
    serverUrl: 'http://localhost:4000',
    payerKeypair: payerKeypair,
    network: 'solana-devnet'
  })

  console.log('\n╔════════════════════════════════════════════════════╗')
  console.log('║    X402 Client SDK - Testing Payment Flow         ║')
  console.log('╚════════════════════════════════════════════════════╝\n')

  console.log('📍 Configuration:')
  console.log('   - Server: http://localhost:4000')
  console.log('   - Wallet:', client.getPayerPublicKey())
  console.log()

  try {
    // Test 0: Health check
    console.log('❤️  Test 0: Health check')
    console.log('────────────────────────────────────')

    const health = await client.requestWithPayment('/health', { method: 'GET' })
    console.log('✅ Server is healthy:', health)
    console.log()

    // Test 1: Access protected endpoint with automatic payment
    console.log('🔒 Test 1: Access protected endpoint')
    console.log('────────────────────────────────────')

    const result = await client.requestWithPayment('/api/protected', { method: 'GET' })
    console.log('✅ Success! Protected endpoint accessed')
    console.log('   Response:', result)
    console.log()

    if (result.payment?.transactionHash) {
      console.log('🔗 Transaction confirmed on Solana')
      console.log(`   View on explorer: https://explorer.solana.com/tx/${result.payment.transactionHash}?cluster=devnet`)
      console.log()
    }

    console.log('✅ All tests completed!')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    if (error.response?.data) {
      console.error('   Server response:', error.response.data)
    }
  }
}

main()
