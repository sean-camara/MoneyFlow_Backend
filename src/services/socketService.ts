import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

let io: Server | null = null;

// Map to track which users are in which rooms
const userRooms = new Map<string, Set<string>>();

export function initializeSocketService(httpServer: HttpServer): Server {
  // Get allowed origins from environment or defaults
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',
    'http://localhost:3000',
    'https://money-flow-six.vercel.app',
  ];

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, etc.)
        if (!origin) return callback(null, true);
        
        // Allow exact matches
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        // Allow all Vercel preview deployments
        if (origin.endsWith('.vercel.app')) {
          return callback(null, true);
        }
        
        // Log blocked origins for debugging
        console.log('🚫 Socket CORS blocked origin:', origin);
        callback(null, false);
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    // iOS Safari compatibility - force polling first, then upgrade to websocket
    transports: ['polling', 'websocket'],
    // Allow upgrade from polling to websocket
    allowUpgrades: true,
    // Increase timeouts for mobile networks
    pingTimeout: 60000,
    pingInterval: 25000,
    // Connection timeout
    connectTimeout: 45000,
    // Allow EIO4 for better iOS compatibility
    allowEIO3: true,
  });

  io.on('connection', (socket: Socket) => {
    console.log('🔌 Client connected:', socket.id, '- Transport:', socket.conn.transport.name);

    // User joins their personal room (for receiving invites)
    socket.on('join-user', (userId: string) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`👤 User ${userId} joined their personal room`);
      }
    });

    // User joins a joint account room (for real-time updates)
    socket.on('join-joint-account', (jointAccountId: string) => {
      if (jointAccountId) {
        socket.join(`joint-account:${jointAccountId}`);
        console.log(`📊 Socket ${socket.id} joined joint account: ${jointAccountId}`);
        
        // Track user rooms for debugging
        if (!userRooms.has(socket.id)) {
          userRooms.set(socket.id, new Set());
        }
        userRooms.get(socket.id)?.add(jointAccountId);
      }
    });

    // User leaves a joint account room
    socket.on('leave-joint-account', (jointAccountId: string) => {
      if (jointAccountId) {
        socket.leave(`joint-account:${jointAccountId}`);
        console.log(`📊 Socket ${socket.id} left joint account: ${jointAccountId}`);
        userRooms.get(socket.id)?.delete(jointAccountId);
      }
    });

    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected:', socket.id);
      userRooms.delete(socket.id);
    });
  });

  console.log('✅ Socket.IO service initialized');
  return io;
}

export function getIO(): Server | null {
  return io;
}

// Emit event to a specific user (by userId)
export function emitToUser(userId: string, event: string, data: any) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
    console.log(`📤 Emitted ${event} to user ${userId}`);
  }
}

// Emit event to all members of a joint account
export function emitToJointAccount(jointAccountId: string, event: string, data: any) {
  if (io) {
    io.to(`joint-account:${jointAccountId}`).emit(event, data);
    console.log(`📤 Emitted ${event} to joint account ${jointAccountId}`);
  }
}

// Socket event types for type safety
export const SocketEvents = {
  // Invite events
  INVITE_RECEIVED: 'invite:received',
  INVITE_ACCEPTED: 'invite:accepted',
  INVITE_DECLINED: 'invite:declined',
  INVITE_CANCELLED: 'invite:cancelled',
  
  // Member events
  MEMBER_JOINED: 'member:joined',
  MEMBER_LEFT: 'member:left',
  MEMBER_REMOVED: 'member:removed',
  
  // Transaction events
  TRANSACTION_ADDED: 'transaction:added',
  TRANSACTION_UPDATED: 'transaction:updated',
  TRANSACTION_DELETED: 'transaction:deleted',
  
  // Joint account events
  JOINT_ACCOUNT_UPDATED: 'joint-account:updated',
  JOINT_ACCOUNT_DELETED: 'joint-account:deleted',
} as const;
