import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
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

// Authentication middleware using Better Auth
export function createAuthMiddleware(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Please sign in to continue'
        });
      }

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
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
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
