import { Keypair } from '@solana/web3.js'
import { X402Client } from '../../solana-sdk/src'
import * as bs58 from 'bs58'
import * as dotenv from 'dotenv'
import * as path from 'path'

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

  let payerKeypair: Keypair
  try {
    // Try base58 decoding first
    const secretKey = bs58.decode(secretKeyString)
    payerKeypair = Keypair.fromSecretKey(secretKey)
  } catch (error) {
    // If base58 fails, try JSON array format [1,2,3,...]
    try {
      const secretKeyArray = JSON.parse(secretKeyString)
      const secretKey = Uint8Array.from(secretKeyArray)
      payerKeypair = Keypair.fromSecretKey(secretKey)
    } catch (e) {
      console.error('❌ PAYER_SECRET_KEY format error')
      console.error('   Expected: base58 string (e.g., "5J...") or JSON array (e.g., "[1,2,3,...]")')
      console.error('   Error:', (error as Error).message)
      process.exit(1)
    }
  }

  console.log('✅ Payer wallet loaded:', payerKeypair.publicKey.toBase58())

  // Create X402 client
  const client = new X402Client({
    serverUrl: 'http://localhost:4000',
    wallet: {
      svm: {
        keypair: payerKeypair
      }
    }
  })

  console.log('\n╔════════════════════════════════════════════════════╗')
  console.log('║    X402 Client SDK - Testing Payment Flow         ║')
  console.log('╚════════════════════════════════════════════════════╝\n')

  console.log('📍 Configuration:')
  console.log('   - Server: http://localhost:4000')
  console.log('   - Wallet:', client.getPayerPublicKey())
  console.log()

  try {
    // Test 1: Access standard protected endpoint with automatic payment
    console.log('🔒 Test 1: Access standard protected endpoint')
    console.log('────────────────────────────────────')

    const result1 = await client.requestWithPayment('/api/standard/protected', { method: 'GET' })
    console.log('✅ Success! Protected endpoint accessed')
    console.log('   Response:', result1)
    console.log()

    if (result1.payment?.transactionHash) {
      console.log('🔗 Transaction confirmed on Solana')
      console.log(`   View on explorer: https://explorer.solana.com/tx/${result1.payment.transactionHash}?cluster=devnet`)
      console.log()
    }

    // Test 2: Access atomic premium endpoint with callback instructions
    console.log('🚀 Test 2: Access atomic premium endpoint')
    console.log('────────────────────────────────────')

    const result2 = await client.requestWithAtomicPayment('/api/atomic/premium?amount=2000000&message=Test&premium=true', { method: 'GET' })
    console.log('✅ Success! Atomic premium endpoint accessed')
    console.log('   Response:', result2)
    console.log()

    if (result2.payment?.settlementTxHash) {
      console.log('🔗 Settlement transaction confirmed')
      console.log(`   View on explorer: https://explorer.solana.com/tx/${result2.payment.settlementTxHash}?cluster=devnet`)
      console.log()
    }

    if (result2.payment?.callbackTxHash) {
      console.log('📞 Callback transaction confirmed')
      console.log(`   View on explorer: https://explorer.solana.com/tx/${result2.payment.callbackTxHash}?cluster=devnet`)
      console.log()
    }

    console.log('✅ All tests completed!')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    console.error('❌ Stack:', error.stack)
    if (error.response?.data) {
      console.error('   Server response:', error.response.data)
    }
  }
}

main()
