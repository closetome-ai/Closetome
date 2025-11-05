# X402 Client Example

This client demonstrates how to make payments using the X402 protocol to access protected endpoints.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Edit `.env` with your test wallet:
```env
PAYER_SECRET_KEY=your_base58_encoded_secret_key_here
```

### Getting a Test Wallet

1. Create a new Solana wallet:
```bash
solana-keygen new --outfile test-wallet.json
```

2. Get the base58 secret key:
```bash
cat test-wallet.json | python3 -c "import json, base58, sys; print(base58.b58encode(bytes(json.load(sys.stdin)[:32])).decode())"
```

3. Get some devnet SOL:
```bash
solana airdrop 2 <your-wallet-address> --url devnet
```

4. Get some devnet USDC (you'll need to use a faucet or swap service)

## Running the Tests

1. Make sure the facilitator is running:
```bash
# Terminal 1
cd ../../facilitator
npm run dev
```

2. Make sure the example server is running:
```bash
# Terminal 2
cd ../server
npm start
```

3. Run the client tests:
```bash
# Terminal 3
npm start
```

## What It Tests

The client performs three tests:

### Test 0: Health Check ❤️
- Verifies the server is running
- No payment required

### Test 1: Access Without Payment 🔍
- Attempts to access protected endpoint without payment
- Should receive 402 Payment Required response
- Shows payment requirements

### Test 2: Access With Payment 💳
- Creates a Solana transaction with:
  - Compute budget instructions (6592 units, 1 microLamport price)
  - USDC transfer of 1 USDC to recipient
- Signs transaction with test wallet
- Sends as X-X402-Payment header
- Should receive successful response with transaction hash

## Expected Output

```
✅ Server is healthy
✅ Correctly received 402 Payment Required
✅ Payer wallet loaded: <your-wallet>
✅ Transaction created and signed
✅ Success! Protected endpoint accessed
🔗 Transaction confirmed on Solana
```

## Troubleshooting

1. **"PAYER_SECRET_KEY not configured"**
   - Set up your test wallet in .env

2. **"Insufficient balance"**
   - Make sure your test wallet has devnet USDC
   - Check balance: `spl-token balance Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr --url devnet`

3. **"Server not responding"**
   - Make sure both facilitator and server are running
   - Check ports 3000 (facilitator) and 4000 (server)

4. **"Payment verification failed"**
   - Check that recipient address matches server configuration
   - Verify amount matches (1 USDC = 1000000 units)