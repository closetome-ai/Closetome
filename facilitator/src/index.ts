import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { getSupportedNetworks } from './routes/supported'
import { verifyPayment } from './routes/verify'
import { settlePayment } from './routes/settle'

// Load environment variables
dotenv.config({
  path: path.join(__dirname, '../.env'),
})

// Create Express app
const app: Express = express()
const PORT = process.env.PORT || 3010

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Logging middleware
app.use((req: Request, res: Response, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// Routes
app.get('/supported', getSupportedNetworks)
app.post('/verify', verifyPayment)
app.post('/settle', settlePayment)

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    name: 'X402 Facilitator Server',
    version: '1.0.0',
    endpoints: {
      'GET /supported': 'Get list of supported payment networks',
      'POST /verify': 'Verify a payment payload',
      'POST /settle': 'Settle (submit) a payment to blockchain',
      'GET /health': 'Health check endpoint'
    }
  })
})

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Unhandled error:', err)
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  })
})

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`X402 Facilitator Server is running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Available endpoints:`)
  console.log(`  GET  http://localhost:${PORT}/supported`)
  console.log(`  POST http://localhost:${PORT}/verify`)
  console.log(`  POST http://localhost:${PORT}/settle`)
  console.log(`  GET  http://localhost:${PORT}/health`)
})