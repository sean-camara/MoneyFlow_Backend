import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { requireJointAccountMember } from '../middleware/jointAccount.js';
import { Transaction, TransactionType, Category } from '../types/index.js';
import { notifyJointAccountMembers } from '../services/pushService.js';
import { emitToJointAccount, SocketEvents } from '../services/socketService.js';
import { Auth } from '../config/auth.js';

export function createTransactionRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Get all transactions for a joint account
  router.get('/joint-account/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;
      const { limit = 100, skip = 0, startDate, endDate, type, category } = req.query;

      const filter: any = { jointAccountId };
      
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = startDate;
        if (endDate) filter.date.$lte = endDate;
      }
      
      if (type) filter.type = type;
      if (category) filter.category = category;

      const transactions = await db.collection<Transaction>('transactions')
        .find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .toArray();

      const total = await db.collection<Transaction>('transactions')
        .countDocuments(filter);

      res.json({ 
        success: true, 
        data: transactions,
        pagination: { total, limit: Number(limit), skip: Number(skip) }
      });
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
    }
  });

  // Create a new transaction
  router.post('/', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const userName = req.user!.name;
      const { 
        jointAccountId, 
        amount, 
        currency, 
        type, 
        category, 
        date, 
        note 
      } = req.body;

      if (!jointAccountId || !amount || !type || !category) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields: jointAccountId, amount, type, category' 
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
      const transaction: Transaction = {
        id: crypto.randomUUID(),
        jointAccountId,
        amount: Number(amount),
        currency: currency || 'USD',
        type,
        category,
        date: date || now.toISOString().split('T')[0],
        note,
        addedByUserId: userId,
        addedByUserName: userName,
        createdAt: now,
        updatedAt: now
      };

      await db.collection<Transaction>('transactions').insertOne(transaction);

      // Emit real-time update to joint account members
      emitToJointAccount(jointAccountId, SocketEvents.TRANSACTION_ADDED, transaction);

      // Send push notifications to other members
      const currencySymbol = currency || 'USD';
      const formattedAmount = Number(amount).toLocaleString();
      const notificationTitle = type === TransactionType.INCOME 
        ? `💰 ${userName} added income` 
        : `💸 ${userName} added an expense`;
      const notificationBody = type === TransactionType.INCOME
        ? `+${currencySymbol} ${formattedAmount} from ${category}`
        : `${currencySymbol} ${formattedAmount} on ${category}`;
      
      // Fire and forget - don't wait for notifications
      // Use absolute URL for icon so it works on mobile
      const iconUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/icon-192.png` : 'https://money-flow-six.vercel.app/icon-192.png';
      notifyJointAccountMembers(jointAccountId, userId, {
        title: notificationTitle,
        body: notificationBody,
        icon: iconUrl,
        tag: `transaction-${transaction.id}`,
        data: { type: 'transaction', transactionId: transaction.id, jointAccountId, url: '/transactions' }
      }).catch(err => console.error('Notification error:', err));

      res.status(201).json({ success: true, data: transaction });
    } catch (error) {
      console.error('Error creating transaction:', error);
      res.status(500).json({ success: false, error: 'Failed to create transaction' });
    }
  });

  // Get a specific transaction
  router.get('/:transactionId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { transactionId } = req.params;
      const userId = req.user!.id;

      const transaction = await db.collection<Transaction>('transactions')
        .findOne({ id: transactionId });

      if (!transaction) {
        return res.status(404).json({ success: false, error: 'Transaction not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: transaction.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      res.json({ success: true, data: transaction });
    } catch (error) {
      console.error('Error fetching transaction:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch transaction' });
    }
  });

  // Update a transaction
  router.put('/:transactionId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { transactionId } = req.params;
      const userId = req.user!.id;
      const { amount, currency, type, category, date, note } = req.body;

      const transaction = await db.collection<Transaction>('transactions')
        .findOne({ id: transactionId });

      if (!transaction) {
        return res.status(404).json({ success: false, error: 'Transaction not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: transaction.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      const updateData: Partial<Transaction> = { updatedAt: new Date() };
      if (amount !== undefined) updateData.amount = Number(amount);
      if (currency) updateData.currency = currency;
      if (type) updateData.type = type;
      if (category) updateData.category = category;
      if (date) updateData.date = date;
      if (note !== undefined) updateData.note = note;

      await db.collection<Transaction>('transactions').updateOne(
        { id: transactionId },
        { $set: updateData }
      );

      const updated = await db.collection<Transaction>('transactions')
        .findOne({ id: transactionId });

      // Emit real-time update to joint account members
      if (updated) {
        emitToJointAccount(transaction.jointAccountId, SocketEvents.TRANSACTION_UPDATED, updated);
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating transaction:', error);
      res.status(500).json({ success: false, error: 'Failed to update transaction' });
    }
  });

  // Delete a transaction
  router.delete('/:transactionId', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { transactionId } = req.params;
      const userId = req.user!.id;

      const transaction = await db.collection<Transaction>('transactions')
        .findOne({ id: transactionId });

      if (!transaction) {
        return res.status(404).json({ success: false, error: 'Transaction not found' });
      }

      // Verify membership
      const membership = await db.collection('jointAccountMembers')
        .findOne({ jointAccountId: transaction.jointAccountId, userId });

      if (!membership) {
        return res.status(403).json({ 
          success: false, 
          error: 'You are not a member of this joint account' 
        });
      }

      await db.collection<Transaction>('transactions').deleteOne({ id: transactionId });

      // Emit real-time update to joint account members
      emitToJointAccount(transaction.jointAccountId, SocketEvents.TRANSACTION_DELETED, {
        transactionId,
        jointAccountId: transaction.jointAccountId
      });

      res.json({ success: true, message: 'Transaction deleted' });
    } catch (error) {
      console.error('Error deleting transaction:', error);
      res.status(500).json({ success: false, error: 'Failed to delete transaction' });
    }
  });

  // Bulk delete transactions
  router.post('/bulk-delete', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const { transactionIds, jointAccountId } = req.body;

      if (!transactionIds || !Array.isArray(transactionIds) || !jointAccountId) {
        return res.status(400).json({ 
          success: false, 
          error: 'transactionIds array and jointAccountId are required' 
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

      const result = await db.collection<Transaction>('transactions').deleteMany({
        id: { $in: transactionIds },
        jointAccountId
      });

      // Emit socket events for each deleted transaction so other users see the deletion in real-time
      for (const transactionId of transactionIds) {
        emitToJointAccount(jointAccountId, SocketEvents.TRANSACTION_DELETED, {
          transactionId,
          jointAccountId,
          deletedBy: userId
        });
      }

      res.json({ 
        success: true, 
        message: `Deleted ${result.deletedCount} transactions` 
      });
    } catch (error) {
      console.error('Error bulk deleting transactions:', error);
      res.status(500).json({ success: false, error: 'Failed to delete transactions' });
    }
  });

  return router;
}
