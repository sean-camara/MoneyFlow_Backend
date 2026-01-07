import { Request, Response, NextFunction } from 'express';
import { Auth } from '../config/auth.js';

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
    if (value) {
      if (Array.isArray(value)) {
        value.forEach(v => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
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
async function verifyTokenFromDb(token: string): Promise<any | null> {
  try {
    const { getDb } = await import('../config/database.js');
    const db = getDb();
    
    // Find session by token
    const session = await db.collection('session').findOne({ token });
    if (!session) return null;
    
    // Check if session is expired
    if (new Date(session.expiresAt) < new Date()) {
      return null;
    }
    
    // Get user
    const user = await db.collection('user').findOne({ id: session.userId });
    if (!user) return null;
    
    return { session, user };
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
      
      let sessionData = null;
      
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
          sessionData = { session: session.session, user: session.user };
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
      req.user = {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        primaryCurrency: (sessionData.user as any).primaryCurrency,
        notificationsEnabled: (sessionData.user as any).notificationsEnabled,
      };
      req.session = {
        id: sessionData.session.id,
        userId: sessionData.session.userId,
        token: sessionData.session.token,
        expiresAt: sessionData.session.expiresAt,
      };

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
      let sessionData = null;
      
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
          sessionData = { session: session.session, user: session.user };
        }
      }

      if (sessionData) {
        req.user = {
          id: sessionData.user.id,
          email: sessionData.user.email,
          name: sessionData.user.name,
          primaryCurrency: (sessionData.user as any).primaryCurrency,
          notificationsEnabled: (sessionData.user as any).notificationsEnabled,
        };
        req.session = {
          id: sessionData.session.id,
          userId: sessionData.session.userId,
          token: sessionData.session.token,
          expiresAt: sessionData.session.expiresAt,
        };
      }

      next();
    } catch (error) {
      // Continue without user
      next();
    }
  };
}
