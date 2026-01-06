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
  
  return headers;
}

// Authentication middleware using Better Auth
export function createAuthMiddleware(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Debug logging
      console.log('🔐 Auth check - cookies:', req.headers.cookie ? 'present' : 'missing');
      
      const headers = getHeadersFromRequest(req);
      
      const session = await auth.api.getSession({
        headers: headers,
      });

      if (!session) {
        console.log('🔐 Auth check - no session found');
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Please sign in to continue'
        });
      }

      console.log('🔐 Auth check - session found for user:', session.user.id);

      // Attach user and session to request
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        primaryCurrency: (session.user as any).primaryCurrency,
        notificationsEnabled: (session.user as any).notificationsEnabled,
      };
      req.session = {
        id: session.session.id,
        userId: session.session.userId,
        token: session.session.token,
        expiresAt: session.session.expiresAt,
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
      const headers = getHeadersFromRequest(req);
      
      const session = await auth.api.getSession({
        headers: headers,
      });

      if (session) {
        req.user = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          primaryCurrency: (session.user as any).primaryCurrency,
          notificationsEnabled: (session.user as any).notificationsEnabled,
        };
        req.session = {
          id: session.session.id,
          userId: session.session.userId,
          token: session.session.token,
          expiresAt: session.session.expiresAt,
        };
      }

      next();
    } catch (error) {
      // Continue without user
      next();
    }
  };
}
