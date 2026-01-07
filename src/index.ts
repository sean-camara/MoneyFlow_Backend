import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { toNodeHandler } from 'better-auth/node';
import { connectToDatabase, closeDatabase } from './config/database.js';
import { createAuth } from './config/auth.js';
import { initializePushService } from './services/pushService.js';
import { initializeEmailService } from './services/emailService.js';
import { initializeSocketService } from './services/socketService.js';
import {
  createJointAccountRoutes,
  createTransactionRoutes,
  createGoalRoutes,
  createSubscriptionRoutes,
  createInsightsRoutes,
  createPushRoutes,
  createUserRoutes
} from './routes/index.js';

const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 3001;

async function startServer() {
  try {
    // Connect to database first
    await connectToDatabase();
    
    // Create auth instance (needs db connection)
    const auth = createAuth();
    
    // Initialize services
    initializePushService();
    initializeEmailService();
    initializeSocketService(httpServer);

    // CORS configuration - allow production URL and Vercel preview deployments
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:5173',
      'http://localhost:3000',
    ];

    app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        // Allow exact matches
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        // Allow all Vercel preview deployments (*.vercel.app)
        if (origin.endsWith('.vercel.app')) {
          return callback(null, true);
        }
        
        // Block other origins
        console.log('🚫 CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Better Auth handler - MUST be before express.json()
    // Handle all auth routes
    app.all('/api/auth/*', toNodeHandler(auth));

    // JSON body parser for other routes
    app.use(express.json());

    // Health check endpoint
    app.get('/api/health', (req, res) => {
      res.json({ 
        success: true, 
        message: 'FlowMoney API is running',
        timestamp: new Date().toISOString()
      });
    });

    // API Routes
    app.use('/api/joint-accounts', createJointAccountRoutes(auth));
    app.use('/api/transactions', createTransactionRoutes(auth));
    app.use('/api/goals', createGoalRoutes(auth));
    app.use('/api/subscriptions', createSubscriptionRoutes(auth));
    app.use('/api/insights', createInsightsRoutes(auth));
    app.use('/api/push', createPushRoutes(auth));
    app.use('/api/user', createUserRoutes(auth));

    // 404 handler
    app.use('/api/*', (req, res) => {
      res.status(404).json({ 
        success: false, 
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`
      });
    });

    // Global error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
      });
    });

    // Start server
    httpServer.listen(port, () => {
      console.log(`
🚀 FlowMoney Backend Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server:     http://localhost:${port}
🔐 Auth:       http://localhost:${port}/api/auth
📊 API:        http://localhost:${port}/api
🔌 WebSocket:  ws://localhost:${port}
🌐 Frontend:   ${process.env.FRONTEND_URL || 'http://localhost:5173'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n📤 Shutting down gracefully...');
      await closeDatabase();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n📤 Shutting down gracefully...');
      await closeDatabase();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
