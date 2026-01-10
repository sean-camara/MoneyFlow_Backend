import { Router, Request, Response } from 'express';
import { Auth } from '../config/auth.js';
import { getDb } from '../config/database.js';
import * as crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

/**
 * Verify password using scrypt (better-auth format: salt:hash)
 */
async function verifyPassword(inputPassword: string, storedPassword: string): Promise<boolean> {
  try {
    const [salt, hash] = storedPassword.split(':');
    if (!salt || !hash) return false;
    
    const derivedKey = await scryptAsync(inputPassword, salt, 64) as Buffer;
    return derivedKey.toString('hex') === hash;
  } catch (e) {
    console.error('Password verification error:', e);
    return false;
  }
}

/**
 * Hash password using scrypt (better-auth compatible format: salt:hash)
 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Custom auth routes that return session tokens in the response body.
 * This is needed for iOS Safari which blocks third-party cookies.
 * 
 * iOS Safari's ITP (Intelligent Tracking Prevention) blocks all cross-origin
 * cookies, which breaks the default cookie-based authentication. These routes
 * return tokens in the response body that can be stored in localStorage.
 */
export function createAuthRoutes(_auth: Auth) {
  const router = Router();

  /**
   * POST /api/auth-token/sign-in
   * Sign in with email/password and return session token
   */
  router.post('/sign-in', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { email, password } = req.body || {};
      
      console.log('📱 Auth-token sign-in attempt for:', email);

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      // Find user by email
      const usersCollection = db.collection('user');
      const user = await usersCollection.findOne({ email: email.toLowerCase() });
      
      if (!user) {
        console.log('❌ User not found:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      // Find account with password hash
      const accountsCollection = db.collection('account');
      const userId = user._id?.toString() || user.id;
      const account = await accountsCollection.findOne({ 
        userId: userId,
        providerId: 'credential'
      });
      
      if (!account || !account.password) {
        console.log('❌ No password account for user:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      // Verify password using scrypt (better-auth format)
      const passwordValid = await verifyPassword(password, account.password);
      
      if (!passwordValid) {
        console.log('❌ Invalid password for:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      // Create session
      const sessionsCollection = db.collection('session');
      const token = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const finalUserId = user._id?.toString() || user.id;
      
      const session = {
        id: crypto.randomUUID(),
        token,
        userId: finalUserId,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };
      
      await sessionsCollection.insertOne(session);
      
      console.log('✅ Session created for user:', finalUserId);

      // Return the session token
      res.json({
        success: true,
        token: session.token,
        user: {
          id: finalUserId,
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
          id: session.id,
          userId: session.userId,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        }
      });
    } catch (error: any) {
      console.error('Sign-in error:', error);
      res.status(500).json({
        success: false,
        error: 'An error occurred during sign in'
      });
    }
  });

  /**
   * POST /api/auth-token/sign-up
   * Sign up with email/password and return session token
   */
  router.post('/sign-up', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { email, password, name } = req.body || {};
      
      console.log('📱 Auth-token sign-up attempt for:', email);

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      // Check if user already exists
      const usersCollection = db.collection('user');
      const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'User already exists'
        });
      }

      // Create user
      const userId = crypto.randomUUID();
      const now = new Date();
      
      const user = {
        id: userId,
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
        primaryCurrency: 'USD',
        notificationsEnabled: true,
        image: null,
      };
      
      await usersCollection.insertOne(user);

      // Create account with hashed password (scrypt, better-auth compatible)
      const accountsCollection = db.collection('account');
      const hashedPassword = await hashPassword(password);
      
      const account = {
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      };
      
      await accountsCollection.insertOne(account);

      // Create session
      const sessionsCollection = db.collection('session');
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      const session = {
        id: crypto.randomUUID(),
        token,
        userId,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };
      
      await sessionsCollection.insertOne(session);
      
      console.log('✅ User created:', userId);

      // Return the session token
      res.json({
        success: true,
        token: session.token,
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
          id: session.id,
          userId: session.userId,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        }
      });
    } catch (error: any) {
      console.error('Sign-up error:', error);
      res.status(500).json({
        success: false,
        error: 'An error occurred during sign up'
      });
    }
  });

  /**
   * GET /api/auth-token/session
   * Get current session from token (for iOS Safari localStorage fallback)
   */
  router.get('/session', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      
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
      const sessionsCollection = db.collection('session');
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

      // Get user data - try both id and _id since better-auth uses id, MongoDB uses _id
      const usersCollection = db.collection('user');
      const { ObjectId } = await import('mongodb');
      let user = await usersCollection.findOne({ id: session.userId });
      if (!user) {
        // Try finding by _id if session.userId is an ObjectId string
        try {
          user = await usersCollection.findOne({ _id: new ObjectId(session.userId) });
        } catch (e) {
          // Invalid ObjectId, user not found
        }
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      const returnUserId = user._id?.toString() || user.id;
      res.json({
        success: true,
        user: {
          id: returnUserId,
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
      const db = getDb();
      
      // Check Authorization header for Bearer token
      const authHeader = req.headers.authorization;
      let token: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      if (token) {
        // Delete the session
        const sessionsCollection = db.collection('session');
        await sessionsCollection.deleteOne({ token });
        console.log('✅ Session invalidated');
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
