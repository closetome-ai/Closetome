# X402 SDK Example Server - Minimal Setup

This is the simplest possible server using the X402 SDK to demonstrate basic verify-settle functionality.

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
- `PORT` - Server port (default: 4000)
- `FACILITATOR_URL` - Your facilitator server URL (default: http://localhost:3000)
- `WALLET_ADDRESS` - Your wallet address to receive payments

3. Make sure the facilitator is running:
```bash
# In the facilitator directory
cd ../../facilitator
npm run dev
```

4. Start the example server:
```bash
npm start
# or for development with auto-reload
npm run dev
```

## Testing

### 1. Health Check (No Payment Required)
```bash
curl http://localhost:4000/health
```

### 2. Protected Endpoint (Payment Required)

Without payment header (will return 402):
```bash
curl http://localhost:4000/api/protected
```

With payment header:
```bash
curl -H "X-X402-Payment: <your-payment-payload>" http://localhost:4000/api/protected
```

## What This Example Does

1. **Single Protected Route**: `/api/protected` requires 1 USDC payment
2. **Auto Verify-Settle**: Automatically verifies and settles payments
3. **Console Logging**: Logs all payment events for debugging
4. **Minimal Configuration**: Uses SDK defaults where possible

## Expected Flow

1. Client makes request to `/api/protected`
2. If no payment header → Returns 402 with payment requirements
3. If payment header present:
   - SDK verifies payment with facilitator
   - If valid, SDK settles payment with facilitator
   - If settlement successful, request continues to endpoint
   - Endpoint returns success response with transaction hash

## Console Output

The server logs detailed information:
- ✅ When payment is verified
- 💰 When payment is settled
- ❌ When payment fails
- 🎯 When protected endpoint is accessed

This helps verify that the SDK's verify-settle flow is working correctly.