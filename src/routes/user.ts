import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { Auth } from '../config/auth.js';

export function createUserRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Clean up unverified account before re-signup (public endpoint)
  router.post('/cleanup-unverified', async (req, res) => {
    try {
      const db = getDb();
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // Find user with this email
      const user = await db.collection('user').findOne({ email: email.toLowerCase() });

      if (!user) {
        // No user exists, safe to signup
        return res.json({ success: true, canSignup: true });
      }

      // Check if user is verified
      if (user.emailVerified) {
        // User is verified, cannot re-signup
        return res.json({ 
          success: true, 
          canSignup: false, 
          message: 'An account with this email already exists. Please sign in.' 
        });
      }

      // User exists but not verified - delete the unverified account and related data
      const userId = user.id;
      
      await Promise.all([
        db.collection('user').deleteOne({ id: userId }),
        db.collection('session').deleteMany({ userId }),
        db.collection('account').deleteMany({ userId }),
      ]);

      console.log(`🗑️ Cleaned up unverified account for ${email}`);

      return res.json({ success: true, canSignup: true, cleaned: true });
    } catch (error) {
      console.error('Error cleaning up unverified account:', error);
      res.status(500).json({ success: false, error: 'Failed to process request' });
    }
  });

  // Get current user profile
  router.get('/me', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;

      const user = await db.collection('user').findOne({ id: userId });

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      // Don't send sensitive data
      const { password, pushSubscription, ...safeUser } = user;

      res.json({ success: true, data: safeUser });
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch user profile' });
    }
  });

  // Update user preferences
  router.put('/preferences', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const { primaryCurrency, notificationsEnabled, name, image } = req.body;

      const updateData: Record<string, any> = { updatedAt: new Date() };
      
      if (primaryCurrency !== undefined) updateData.primaryCurrency = primaryCurrency;
      if (notificationsEnabled !== undefined) updateData.notificationsEnabled = notificationsEnabled;
      if (name !== undefined) updateData.name = name;
      if (image !== undefined) updateData.image = image;

      await db.collection('user').updateOne(
        { id: userId },
        { $set: updateData }
      );

      const updated = await db.collection('user').findOne({ id: userId }) as Record<string, any> | null;
      const { password, pushSubscription, ...safeUser } = updated || {} as Record<string, any>;

      res.json({ success: true, data: safeUser });
    } catch (error) {
      console.error('Error updating preferences:', error);
      res.status(500).json({ success: false, error: 'Failed to update preferences' });
    }
  });

  return router;
}
