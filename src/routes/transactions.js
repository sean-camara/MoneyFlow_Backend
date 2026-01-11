const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');
const admin = require('firebase-admin');

const router = express.Router();

// Helper function to notify joint account members
async function notifyJointAccountMembers(db, jointAccountId, excludeUserId, title, body) {
  try {
    // Get the joint account with members
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    if (!jointAccount) return;

    // Get all member IDs except the one who made the change
    const memberIds = jointAccount.members
      .map(m => m.userId)
      .filter(id => id.toString() !== excludeUserId.toString());

    if (memberIds.length === 0) return;

    // Get all push subscriptions for these members
    const subscriptions = await db.collection('pushSubscriptions')
      .find({ userId: { $in: memberIds } })
      .toArray();

    if (subscriptions.length === 0) return;

    const tokens = subscriptions.map(s => s.fcmToken);

    // Send push notifications
    await admin.messaging().sendEachForMulticast({
      notification: { title, body },
      data: {
        type: 'joint_transaction',
        jointAccountId: jointAccountId.toString()
      },
      tokens
    });
  } catch (error) {
    console.error('Failed to notify joint account members:', error);
  }
}

// Default categories
const DEFAULT_CATEGORIES = [
  { name: 'Food', icon: '🍔', color: '#F59E0B', isDefault: true },
  { name: 'Transport', icon: '🚗', color: '#3B82F6', isDefault: true },
  { name: 'Bills', icon: '📄', color: '#EF4444', isDefault: true },
  { name: 'Entertainment', icon: '🎮', color: '#8B5CF6', isDefault: true },
  { name: 'Shopping', icon: '🛍️', color: '#EC4899', isDefault: true },
  { name: 'Health', icon: '💊', color: '#10B981', isDefault: true },
  { name: 'Education', icon: '📚', color: '#6366F1', isDefault: true },
  { name: 'Salary', icon: '💰', color: '#22C55E', isDefault: true, isIncome: true },
  { name: 'Investment', icon: '📈', color: '#14B8A6', isDefault: true, isIncome: true },
  { name: 'Other', icon: '📦', color: '#6B7280', isDefault: true }
];

// GET /api/transactions - List user's transactions
router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    // Query parameters
    const {
      page = 1,
      limit = 50,
      type,
      category,
      startDate,
      endDate,
      jointAccountId,
      search
    } = req.query;

    // Build query
    const query = {};
    
    if (jointAccountId) {
      query.jointAccountId = new ObjectId(jointAccountId);
    } else {
      query.userId = new ObjectId(userId);
      query.jointAccountId = { $exists: false };
    }

    if (type && ['INCOME', 'EXPENSE'].includes(type)) {
      query.type = type;
    }

    if (category) {
      query.category = category;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (search) {
      query.note = { $regex: search, $options: 'i' };
    }

    // Get total count
    const total = await db.collection('transactions').countDocuments(query);

    // Get transactions with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let transactions = await db.collection('transactions')
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    // For joint account transactions, populate the creator's name
    if (jointAccountId && transactions.length > 0) {
      const userIds = [...new Set(transactions.map(t => t.userId.toString()))];
      const users = await db.collection('users')
        .find({ _id: { $in: userIds.map(id => new ObjectId(id)) } })
        .project({ _id: 1, name: 1, image: 1 })
        .toArray();
      
      const userMap = {};
      users.forEach(u => {
        userMap[u._id.toString()] = { name: u.name, image: u.image };
      });
      
      transactions = transactions.map(t => ({
        ...t,
        creatorName: userMap[t.userId.toString()]?.name || 'Unknown',
        creatorImage: userMap[t.userId.toString()]?.image || null
      }));
    }

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// POST /api/transactions - Create transaction
router.post('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    const {
      amount,
      currency = 'PHP',
      type,
      category,
      note = '',
      date,
      attachment,
      jointAccountId
    } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    if (!type || !['INCOME', 'EXPENSE'].includes(type)) {
      return res.status(400).json({ error: 'Type must be INCOME or EXPENSE' });
    }

    if (!category) {
      return res.status(400).json({ error: 'Category is required' });
    }

    // If joint account, verify membership and permission
    if (jointAccountId) {
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: new ObjectId(jointAccountId),
        'members.userId': new ObjectId(userId)
      });

      if (!jointAccount) {
        return res.status(403).json({ error: 'Not a member of this joint account' });
      }

      // Check if member has edit permission (owner, admin, or editor)
      const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
      if (member && member.role === 'viewer') {
        return res.status(403).json({ error: 'You have view-only access to this account' });
      }
    }

    const transaction = {
      userId: new ObjectId(userId),
      amount: parseFloat(amount),
      currency,
      type,
      category,
      note,
      date: date ? new Date(date) : new Date(),
      attachment: attachment || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (jointAccountId) {
      transaction.jointAccountId = new ObjectId(jointAccountId);
    }

    const result = await db.collection('transactions').insertOne(transaction);
    transaction._id = result.insertedId;

    // Emit socket event for real-time sync
    const io = req.app.get('io');
    if (jointAccountId) {
      io.to(`joint:${jointAccountId}`).emit('transaction-created', transaction);
      
      // Get user info and notify other joint account members via push
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { name: 1, image: 1 } }
      );
      const jointAccount = await db.collection('jointAccounts').findOne(
        { _id: new ObjectId(jointAccountId) },
        { projection: { name: 1 } }
      );
      
      const formattedAmount = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: currency || 'PHP'
      }).format(amount);
      
      const actionText = type === 'INCOME' ? 'added income' : 'added expense';
      await notifyJointAccountMembers(
        db,
        jointAccountId,
        userId,
        `${jointAccount?.name || 'Joint Account'}`,
        `${user?.name || 'Someone'} ${actionText}: ${formattedAmount} (${category})`
      );

      // Auto-announce transaction in chat
      const emoji = type === 'INCOME' ? '💰' : '💸';
      const chatMessage = {
        jointAccountId: new ObjectId(jointAccountId),
        senderId: new ObjectId(userId),
        senderName: user?.name || 'Unknown',
        senderImage: user?.image || null,
        content: `${emoji} ${user?.name || 'Someone'} ${actionText}: ${formattedAmount} for ${category}${note ? ` - "${note}"` : ''}`,
        type: 'transaction_announcement',
        transactionData: {
          _id: transaction._id,
          amount: transaction.amount,
          currency: transaction.currency,
          type: transaction.type,
          category: transaction.category,
          note: transaction.note,
          date: transaction.date
        },
        readBy: [{
          userId: new ObjectId(userId),
          readAt: new Date()
        }],
        createdAt: new Date()
      };

      await db.collection('chatMessages').insertOne(chatMessage);
      io.to(`joint:${jointAccountId}`).emit('new-chat-message', chatMessage);
    } else {
      io.to(`user:${userId}`).emit('transaction-created', transaction);
    }

    res.status(201).json(transaction);
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// PUT /api/transactions/:id - Update transaction
router.put('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const transactionId = req.params.id;

    // Find transaction
    const transaction = await db.collection('transactions').findOne({
      _id: new ObjectId(transactionId)
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check ownership (either direct owner or joint account member with edit permission)
    const isOwner = transaction.userId.toString() === userId.toString();
    let isJointMember = false;
    let canEdit = false;

    if (transaction.jointAccountId) {
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: transaction.jointAccountId,
        'members.userId': new ObjectId(userId)
      });
      isJointMember = !!jointAccount;
      
      // Check if member has edit permission
      if (jointAccount) {
        const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
        canEdit = member && ['owner', 'admin', 'editor'].includes(member.role);
      }
    } else {
      canEdit = isOwner;
    }

    if (!isOwner && !isJointMember) {
      return res.status(403).json({ error: 'Not authorized to update this transaction' });
    }

    if (transaction.jointAccountId && !canEdit) {
      return res.status(403).json({ error: 'You have view-only access to this account' });
    }

    const { amount, currency, type, category, note, date, attachment } = req.body;

    const updates = { updatedAt: new Date() };
    if (amount !== undefined) updates.amount = parseFloat(amount);
    if (currency !== undefined) updates.currency = currency;
    if (type !== undefined) updates.type = type;
    if (category !== undefined) updates.category = category;
    if (note !== undefined) updates.note = note;
    if (date !== undefined) updates.date = new Date(date);
    if (attachment !== undefined) updates.attachment = attachment;

    await db.collection('transactions').updateOne(
      { _id: new ObjectId(transactionId) },
      { $set: updates }
    );

    const updatedTransaction = await db.collection('transactions').findOne({
      _id: new ObjectId(transactionId)
    });

    // Emit socket event
    const io = req.app.get('io');
    if (transaction.jointAccountId) {
      io.to(`joint:${transaction.jointAccountId}`).emit('transaction-updated', updatedTransaction);
    } else {
      io.to(`user:${userId}`).emit('transaction-updated', updatedTransaction);
    }

    res.json(updatedTransaction);
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// DELETE /api/transactions/:id - Delete transaction
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const transactionId = req.params.id;

    // Find transaction
    const transaction = await db.collection('transactions').findOne({
      _id: new ObjectId(transactionId)
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check ownership and permissions
    const isOwner = transaction.userId.toString() === userId.toString();
    let isJointMember = false;
    let canDelete = false;

    if (transaction.jointAccountId) {
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: transaction.jointAccountId,
        'members.userId': new ObjectId(userId)
      });
      isJointMember = !!jointAccount;
      
      // Check if member has edit permission
      if (jointAccount) {
        const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
        canDelete = member && ['owner', 'admin', 'editor'].includes(member.role);
      }
    } else {
      canDelete = isOwner;
    }

    if (!isOwner && !isJointMember) {
      return res.status(403).json({ error: 'Not authorized to delete this transaction' });
    }

    if (transaction.jointAccountId && !canDelete) {
      return res.status(403).json({ error: 'You have view-only access to this account' });
    }

    await db.collection('transactions').deleteOne({ _id: new ObjectId(transactionId) });

    // Emit socket event
    const io = req.app.get('io');
    if (transaction.jointAccountId) {
      io.to(`joint:${transaction.jointAccountId}`).emit('transaction-deleted', { _id: transactionId });
    } else {
      io.to(`user:${userId}`).emit('transaction-deleted', { _id: transactionId });
    }

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// GET /api/transactions/stats - Get transaction statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { startDate, endDate, jointAccountId } = req.query;

    const matchStage = {};
    
    if (jointAccountId) {
      matchStage.jointAccountId = new ObjectId(jointAccountId);
    } else {
      matchStage.userId = new ObjectId(userId);
      matchStage.jointAccountId = { $exists: false };
    }

    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = new Date(startDate);
      if (endDate) matchStage.date.$lte = new Date(endDate);
    }

    const stats = await db.collection('transactions').aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const byCategory = await db.collection('transactions').aggregate([
      { $match: { ...matchStage, type: 'EXPENSE' } },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]).toArray();

    const income = stats.find(s => s._id === 'INCOME')?.total || 0;
    const expense = stats.find(s => s._id === 'EXPENSE')?.total || 0;

    res.json({
      income,
      expense,
      balance: income - expense,
      byCategory
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

module.exports = router;
