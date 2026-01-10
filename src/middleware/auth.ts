import { Request, Response, NextFunction } from 'express';
import { Auth } from '../config/auth.js';

// Session data type
interface SessionData {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    primaryCurrency?: string;
    notificationsEnabled?: boolean;
  };
}

// Extend Express Request to include user and session
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        primaryCurrency?: string;
        notificationsEnabled?: boolean;
      };
      session?: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
      };
    }
  }
}

// Helper to convert Express request to headers for Better Auth
function getHeadersFromRequest(req: Request): Headers {
  const headers = new Headers();
  
  // Copy all headers
  for (const [key, value] of Object.entries(req.headers)) {
    if (value && typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      value.forEach(v => headers.append(key, v));
    }
  }
  
  // Ensure cookies are included
  if (req.headers.cookie) {
    headers.set('cookie', req.headers.cookie);
  }
  
  // Also include Authorization header if present (for Bearer token auth)
  if (req.headers.authorization) {
    headers.set('authorization', req.headers.authorization);
  }
  
  return headers;
}

// Verify session token directly from database
async function verifyTokenFromDb(token: string): Promise<SessionData | null> {
  try {
    const { getDb } = await import('../config/database.js');
    const { ObjectId } = await import('mongodb');
    const db = getDb();
    
    // Find session by token
    const session = await db.collection('session').findOne({ token });
    if (!session) return null;
    
    // Check if session is expired
    if (new Date(session.expiresAt) < new Date()) {
      return null;
    }
    
    // Get user - try both id and _id since better-auth uses id, MongoDB uses _id
    let user = await db.collection('user').findOne({ id: session.userId });
    if (!user) {
      // Try finding by _id if session.userId is an ObjectId string
      try {
        user = await db.collection('user').findOne({ _id: new ObjectId(session.userId) });
      } catch (e) {
        // Invalid ObjectId, continue
      }
    }
    if (!user) return null;

    const userId = user._id?.toString() || user.id;
    return {
      session: {
        id: session.id,
        userId: userId,
        token: session.token,
        expiresAt: session.expiresAt,
      },
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        primaryCurrency: user.primaryCurrency,
        notificationsEnabled: user.notificationsEnabled,
      }
    };
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

// Authentication middleware using Better Auth
export function createAuthMiddleware(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Debug logging
      const hasCookies = !!req.headers.cookie;
      const hasBearer = !!req.headers.authorization?.startsWith('Bearer ');
      console.log('🔐 Auth check - cookies:', hasCookies ? 'present' : 'missing', '| bearer:', hasBearer ? 'present' : 'missing');
      
      let sessionData: SessionData | null = null;
      
      // First try Bearer token if present
      if (hasBearer) {
        const token = req.headers.authorization!.split(' ')[1];
        sessionData = await verifyTokenFromDb(token);
        if (sessionData) {
          console.log('🔐 Auth via Bearer token for user:', sessionData.user.id);
        }
      }
      
      // Fall back to Better Auth session (cookies)
      if (!sessionData) {
        const headers = getHeadersFromRequest(req);
        const session = await auth.api.getSession({
          headers: headers,
        });
        if (session) {
          sessionData = {
            session: {
              id: session.session.id,
              userId: session.session.userId,
              token: session.session.token,
              expiresAt: session.session.expiresAt,
            },
            user: {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
              primaryCurrency: (session.user as any).primaryCurrency,
              notificationsEnabled: (session.user as any).notificationsEnabled,
            }
          };
          console.log('🔐 Auth via cookies for user:', session.user.id);
        }
      }

      if (!sessionData) {
        console.log('🔐 Auth check - no session found');
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Please sign in to continue'
        });
      }

      console.log('🔐 Auth check - session found for user:', sessionData.user.id);

      // Attach user and session to request
      req.user = sessionData.user;
      req.session = sessionData.session;

      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid or expired session'
      });
    }
  };
}

// Optional auth middleware - attaches user if authenticated but doesn't block
export function createOptionalAuthMiddleware(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let sessionData: SessionData | null = null;
      
      // Try Bearer token first
      if (req.headers.authorization?.startsWith('Bearer ')) {
        const token = req.headers.authorization.split(' ')[1];
        sessionData = await verifyTokenFromDb(token);
      }
      
      // Fall back to cookies
      if (!sessionData) {
        const headers = getHeadersFromRequest(req);
        const session = await auth.api.getSession({
          headers: headers,
        });
        if (session) {
          sessionData = {
            session: {
              id: session.session.id,
              userId: session.session.userId,
              token: session.session.token,
              expiresAt: session.session.expiresAt,
            },
            user: {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
              primaryCurrency: (session.user as any).primaryCurrency,
              notificationsEnabled: (session.user as any).notificationsEnabled,
            }
          };
        }
      }

      if (sessionData) {
        req.user = sessionData.user;
        req.session = sessionData.session;
      }

      next();
    } catch (error) {
      // Continue without user
      next();
    }
  };
}
