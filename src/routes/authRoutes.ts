import { Router, Request, Response } from 'express';
import { Auth } from '../config/auth.js';
import { getDb } from '../config/database.js';

/**
 * Custom auth routes that return session tokens in the response body.
 * This is needed for iOS Safari which blocks third-party cookies.
 * 
 * These routes wrap better-auth functionality and additionally return
 * the session token so clients can store it in localStorage.
 */
export function createAuthRoutes(auth: Auth) {
  const router = Router();
  const db = getDb();
  const sessionsCollection = db.collection('session');
  const usersCollection = db.collection('user');

  /**
   * POST /api/auth-token/sign-in
   * Sign in with email/password and return session token
   */
  router.post('/sign-in', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      // Use better-auth's internal sign-in
      let result;
      try {
        result = await auth.api.signInEmail({
          body: { email, password },
          asResponse: false
        });
      } catch (authError: any) {
        console.error('Better-Auth sign-in error:', authError.message || authError);
        return res.status(401).json({
          success: false,
          error: authError.message || 'Invalid email or password'
        });
      }

      if (!result || !result.token || !result.user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      // Look up the session in DB for more details
      const session = await sessionsCollection.findOne({ token: result.token });

      // Return the session token in the response body for iOS Safari
      res.json({
        success: true,
        token: result.token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          image: result.user.image,
          primaryCurrency: result.user.primaryCurrency,
          notificationsEnabled: result.user.notificationsEnabled,
          emailVerified: result.user.emailVerified,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
        session: session ? {
          id: session.id || session._id?.toString(),
          userId: session.userId,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        } : null
      });
    } catch (error: any) {
      console.error('Sign-in error:', error);
      res.status(401).json({
        success: false,
        error: error.message || 'Invalid credentials'
      });
    }
  });

  /**
   * POST /api/auth-token/sign-up
   * Sign up with email/password and return session token
   */
  router.post('/sign-up', async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      // Use better-auth's internal sign-up
      let result;
      try {
        result = await auth.api.signUpEmail({
          body: { email, password, name },
          asResponse: false
        });
      } catch (authError: any) {
        console.error('Better-Auth sign-up error:', authError.message || authError);
        return res.status(400).json({
          success: false,
          error: authError.message || 'Failed to create account'
        });
      }

      if (!result || !result.token || !result.user) {
        return res.status(400).json({
          success: false,
          error: 'Failed to create account'
        });
      }

      // Look up the session in DB for more details
      const session = await sessionsCollection.findOne({ token: result.token });

      // Return the session token in the response body for iOS Safari
      res.json({
        success: true,
        token: result.token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          image: result.user.image,
          primaryCurrency: result.user.primaryCurrency,
          notificationsEnabled: result.user.notificationsEnabled,
          emailVerified: result.user.emailVerified,
          createdAt: result.user.createdAt,
          updatedAt: result.user.updatedAt,
        },
        session: session ? {
          id: session.id || session._id?.toString(),
          userId: session.userId,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        } : null
      });
    } catch (error: any) {
      console.error('Sign-up error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create account'
      });
    }
  });

  /**
   * GET /api/auth-token/session
   * Get current session from token (for iOS Safari localStorage fallback)
   */
  router.get('/session', async (req: Request, res: Response) => {
    try {
      // Check Authorization header for Bearer token
      const authHeader = req.headers.authorization;
      let token: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'No token provided'
        });
      }

      // Look up session by token
      const session = await sessionsCollection.findOne({ token });

      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session'
        });
      }

      // Check if session is expired
      if (new Date(session.expiresAt) < new Date()) {
        // Delete expired session
        await sessionsCollection.deleteOne({ token });
        return res.status(401).json({
          success: false,
          error: 'Session expired'
        });
      }

      // Get user data
      const user = await usersCollection.findOne({ id: session.userId });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          primaryCurrency: user.primaryCurrency,
          notificationsEnabled: user.notificationsEnabled,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        session: {
          id: session.id || session._id?.toString(),
          userId: session.userId,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        }
      });
    } catch (error: any) {
      console.error('Session fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch session'
      });
    }
  });

  /**
   * POST /api/auth-token/sign-out
   * Sign out and invalidate token
   */
  router.post('/sign-out', async (req: Request, res: Response) => {
    try {
      // Check Authorization header for Bearer token
      const authHeader = req.headers.authorization;
      let token: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      if (token) {
        // Delete the session
        await sessionsCollection.deleteOne({ token });
      }

      res.json({
        success: true,
        message: 'Signed out successfully'
      });
    } catch (error: any) {
      console.error('Sign-out error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to sign out'
      });
    }
  });

  return router;
}
