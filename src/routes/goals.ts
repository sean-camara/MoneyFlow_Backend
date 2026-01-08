import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { requireJointAccountMember } from '../middleware/jointAccount.js';
import { notifyJointAccountMembers } from '../services/pushService.js';
import { Goal } from '../types/index.js';
import { Auth } from '../config/auth.js';

export function createGoalRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Get all goals for a joint account
  router.get('/joint-account/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;

      const goals = await db.collection<Goal>('goals')
        .find({ jointAccountId })
        .sort({ createdAt: -1 })
        .toArray();

      res.json({ success: true, data: goals });
    } catch (error) {
      console.error('Error fetching goals:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch goals' });
    }
  });

  // Create a new goal
  router.post('/', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const { jointAccountId, name, targetAmount, currentAmount = 0, currency, deadline } = req.body;

      if (!jointAccountId || !name || !targetAmount) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields: jointAccountId, name, targetAmount' 
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

      // Get user info for notification
      const user = await db.collection('user').findOne({ id: userId });

      const now = new Date();
      const goal: Goal = {
        id: crypto.randomUUID(),
        jointAccountId,
        name,
        targetAmount: Number(targetAmount),
        currentAmount: Number(currentAmount),
        currency: currency || 'USD',
        deadline,
        createdAt: now,
        updatedAt: now
      };

      await db.collection<Goal>('goals').insertOne(goal);

      // Notify other members about new goal
      const iconUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/icon-192.png` : 'https://money-flow-six.vercel.app/icon-192.png';
      notifyJointAccountMembers(jointAccountId, userId, {
        title: `🎯 ${user?.name || 'Someone'} created a goal`,
        body: `"${name}" with target of ${currency || 'USD'} ${Number(targetAmount).toLocaleString()}`,
        icon: iconUrl,
        tag: `goal-created-${goal.id}`,
        data: { type: 'goal', goalId: goal.id, jointAccountId, url: '/goals' }
      }).catch(err => console.error('Goal notification error:', err));

      res.status(201).json({ success: true, data: goal });
    } catch (error) {
      console.error('Error creating goal:', error);
      res.status(500).json({ success: false, error: 'Failed to create goal' });
    }
  });

  // Update a goal
  router.put('/:goalId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { goalId } = req.params;
      const userId = req.user!.id;
      const { name, targetAmount, currentAmount, currency, deadline } = req.body;

      const goal = await db.collection<Goal>('goals').findOne({ id: goalId });

      if (!goal) {
        return res.status(404).json({ success: false, error: 'Goal not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: goal.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      // Get user info for notification
      const user = await db.collection('user').findOne({ id: userId });

      const updateData: Partial<Goal> = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (targetAmount !== undefined) updateData.targetAmount = Number(targetAmount);
      if (currentAmount !== undefined) updateData.currentAmount = Number(currentAmount);
      if (currency) updateData.currency = currency;
      if (deadline !== undefined) updateData.deadline = deadline;

      await db.collection<Goal>('goals').updateOne(
        { id: goalId },
        { $set: updateData }
      );

      const updated = await db.collection<Goal>('goals').findOne({ id: goalId });

      // Check if progress was made on the goal
      if (currentAmount !== undefined && updated) {
        const oldProgress = (goal.currentAmount / goal.targetAmount) * 100;
        const newProgress = (updated.currentAmount / updated.targetAmount) * 100;
        
        // Notify if significant progress (crossed a milestone or goal achieved)
        if (newProgress >= 100 && oldProgress < 100) {
          // Goal achieved!
          notifyJointAccountMembers(goal.jointAccountId, userId, {
            title: '🎉 Goal achieved!',
            body: `"${goal.name}" has reached ${goal.currency} ${goal.targetAmount.toLocaleString()}!`,
            icon: 'https://money-flow-six.vercel.app/icon-192.png',
            tag: `goal-achieved-${goal.id}`,
            data: { type: 'goal-achieved', goalId: goal.id, jointAccountId: goal.jointAccountId, url: '/goals' }
          }).catch(err => console.error('Goal notification error:', err));
        } else if (newProgress > oldProgress && (Math.floor(newProgress / 25) > Math.floor(oldProgress / 25))) {
          // Crossed a 25% milestone
          const milestone = Math.floor(newProgress / 25) * 25;
          notifyJointAccountMembers(goal.jointAccountId, userId, {
            title: `📈 ${user?.name || 'Someone'} updated a goal`,
            body: `"${goal.name}" is now at ${milestone}% (${goal.currency} ${updated.currentAmount.toLocaleString()})`,
            icon: 'https://money-flow-six.vercel.app/icon-192.png',
            tag: `goal-progress-${goal.id}`,
            data: { type: 'goal-progress', goalId: goal.id, jointAccountId: goal.jointAccountId, url: '/goals' }
          }).catch(err => console.error('Goal notification error:', err));
        }
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating goal:', error);
      res.status(500).json({ success: false, error: 'Failed to update goal' });
    }
  });

  // Delete a goal
  router.delete('/:goalId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { goalId } = req.params;
      const userId = req.user!.id;

      const goal = await db.collection<Goal>('goals').findOne({ id: goalId });

      if (!goal) {
        return res.status(404).json({ success: false, error: 'Goal not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: goal.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      await db.collection<Goal>('goals').deleteOne({ id: goalId });

      res.json({ success: true, message: 'Goal deleted' });
    } catch (error) {
      console.error('Error deleting goal:', error);
      res.status(500).json({ success: false, error: 'Failed to delete goal' });
    }
  });

  return router;
}
