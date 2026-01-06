import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { requireJointAccountMember } from '../middleware/jointAccount.js';
import { Subscription } from '../types/index.js';
import { Auth } from '../config/auth.js';

export function createSubscriptionRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Get all subscriptions for a joint account
  router.get('/joint-account/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;

      const subscriptions = await db.collection<Subscription>('subscriptions')
        .find({ jointAccountId })
        .sort({ nextBillingDate: 1 })
        .toArray();

      res.json({ success: true, data: subscriptions });
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch subscriptions' });
    }
  });

  // Create a new subscription
  router.post('/', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const { jointAccountId, name, amount, currency, cycle, nextBillingDate } = req.body;

      if (!jointAccountId || !name || !amount || !cycle) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields: jointAccountId, name, amount, cycle' 
        });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      const now = new Date();
      const subscription: Subscription = {
        id: crypto.randomUUID(),
        jointAccountId,
        name,
        amount: Number(amount),
        currency: currency || 'USD',
        cycle,
        nextBillingDate: nextBillingDate || now.toISOString().split('T')[0],
        createdAt: now,
        updatedAt: now
      };

      await db.collection<Subscription>('subscriptions').insertOne(subscription);

      res.status(201).json({ success: true, data: subscription });
    } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ success: false, error: 'Failed to create subscription' });
    }
  });

  // Update a subscription
  router.put('/:subscriptionId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { subscriptionId } = req.params;
      const userId = req.user!.id;
      const { name, amount, currency, cycle, nextBillingDate } = req.body;

      const subscription = await db.collection<Subscription>('subscriptions')
        .findOne({ id: subscriptionId });

      if (!subscription) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: subscription.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      const updateData: Partial<Subscription> = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (amount !== undefined) updateData.amount = Number(amount);
      if (currency) updateData.currency = currency;
      if (cycle) updateData.cycle = cycle;
      if (nextBillingDate) updateData.nextBillingDate = nextBillingDate;

      await db.collection<Subscription>('subscriptions').updateOne(
        { id: subscriptionId },
        { $set: updateData }
      );

      const updated = await db.collection<Subscription>('subscriptions')
        .findOne({ id: subscriptionId });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating subscription:', error);
      res.status(500).json({ success: false, error: 'Failed to update subscription' });
    }
  });

  // Delete a subscription
  router.delete('/:subscriptionId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { subscriptionId } = req.params;
      const userId = req.user!.id;

      const subscription = await db.collection<Subscription>('subscriptions')
        .findOne({ id: subscriptionId });

      if (!subscription) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: subscription.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      await db.collection<Subscription>('subscriptions').deleteOne({ id: subscriptionId });

      res.json({ success: true, message: 'Subscription deleted' });
    } catch (error) {
      console.error('Error deleting subscription:', error);
      res.status(500).json({ success: false, error: 'Failed to delete subscription' });
    }
  });

  return router;
}
