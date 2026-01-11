const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');
const admin = require('firebase-admin');

const router = express.Router();

// Helper function to send push notification
async function sendChatPushNotification(userIds, senderName, message, jointAccountName, jointAccountId, db) {
  try {
    // Get all FCM tokens for these users
    const subscriptions = await db.collection('pushSubscriptions')
      .find({ userId: { $in: userIds.map(id => new ObjectId(id)) } })
      .toArray();

    if (subscriptions.length === 0) return;

    const tokens = subscriptions.map(s => s.fcmToken);

    const notificationMessage = {
      notification: {
        title: `${senderName} in ${jointAccountName}`,
        body: message.length > 100 ? message.substring(0, 100) + '...' : message
      },
      data: {
        type: 'chat_message',
        jointAccountId: jointAccountId.toString()
      },
      tokens
    };

    await admin.messaging().sendEachForMulticast(notificationMessage);
  } catch (error) {
    console.error('Chat push notification error:', error);
  }
}

// GET /api/chat/conversations - Get all chat conversations (joint accounts user is part of)
router.get('/conversations', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    // Get all joint accounts user is a member of
    const jointAccounts = await db.collection('jointAccounts')
      .find({
        'members.userId': new ObjectId(userId)
      })
      .toArray();

    // Get unread counts and last messages for each joint account
    const conversations = await Promise.all(jointAccounts.map(async (account) => {
      // Get last message
      const lastMessage = await db.collection('chatMessages')
        .findOne(
          { jointAccountId: account._id },
          { sort: { createdAt: -1 } }
        );

      // Get unread count for this user
      const unreadCount = await db.collection('chatMessages')
        .countDocuments({
          jointAccountId: account._id,
          'readBy.userId': { $ne: new ObjectId(userId) },
          senderId: { $ne: new ObjectId(userId) } // Don't count own messages
        });

      // Get member details
      const memberIds = account.members.map(m => m.userId);
      const members = await db.collection('users')
        .find({ _id: { $in: memberIds } })
        .project({ name: 1, email: 1, image: 1 })
        .toArray();

      // Map member info
      const memberInfo = account.members.map(m => {
        const user = members.find(u => u._id.toString() === m.userId.toString());
        return {
          userId: m.userId,
          name: user?.name || 'Unknown',
          email: user?.email,
          image: user?.image,
          role: m.role
        };
      });

      return {
        _id: account._id,
        name: account.name,
        members: memberInfo,
        lastMessage: lastMessage ? {
          _id: lastMessage._id,
          content: lastMessage.content,
          type: lastMessage.type,
          senderName: lastMessage.senderName,
          senderId: lastMessage.senderId,
          createdAt: lastMessage.createdAt
        } : null,
        unreadCount,
        updatedAt: lastMessage?.createdAt || account.updatedAt
      };
    }));

    // Sort by last activity
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    // Get total unread count across all conversations
    const totalUnread = conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);

    res.json({ conversations, totalUnread });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// GET /api/chat/:jointAccountId/messages - Get messages for a joint account
router.get('/:jointAccountId/messages', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { before, limit = 50 } = req.query;

    // Verify user is a member of the joint account
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Build query
    const query = { jointAccountId: new ObjectId(jointAccountId) };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    // Get messages
    let messages = await db.collection('chatMessages')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .toArray();

    // Reverse to get chronological order
    messages.reverse();

    // For split request messages, fetch the current participant status
    const splitRequestIds = messages
      .filter(m => m.type === 'split_request' && m.splitRequestId)
      .map(m => m.splitRequestId);

    if (splitRequestIds.length > 0) {
      const splitRequests = await db.collection('splitRequests')
        .find({ _id: { $in: splitRequestIds } })
        .toArray();

      // Map split request data to messages
      messages = messages.map(msg => {
        if (msg.type === 'split_request' && msg.splitRequestId) {
          const splitRequest = splitRequests.find(
            sr => sr._id.toString() === msg.splitRequestId.toString()
          );
          if (splitRequest) {
            // Find current user's status
            const myParticipation = splitRequest.participants.find(
              p => p.userId.toString() === userId.toString()
            );
            msg.splitData = {
              ...msg.splitData,
              myStatus: myParticipation?.status || null, // 'pending', 'paid', 'declined'
              participants: splitRequest.participants.map(p => ({
                odId: p.userId,
                status: p.status
              }))
            };
          }
        }
        return msg;
      });
    }

    // Mark messages as read by this user
    await db.collection('chatMessages').updateMany(
      {
        jointAccountId: new ObjectId(jointAccountId),
        'readBy.userId': { $ne: new ObjectId(userId) },
        senderId: { $ne: new ObjectId(userId) }
      },
      {
        $push: {
          readBy: {
            userId: new ObjectId(userId),
            readAt: new Date()
          }
        }
      }
    );

    res.json({ messages, hasMore: messages.length === parseInt(limit) });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// POST /api/chat/:jointAccountId/messages - Send a message
router.post('/:jointAccountId/messages', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { content, type = 'text', fileName, fileSize, mimeType } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Get sender info
    const sender = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    // Create message
    const message = {
      jointAccountId: new ObjectId(jointAccountId),
      senderId: new ObjectId(userId),
      senderName: sender.name,
      senderImage: sender.image,
      content,
      type, // 'text', 'image', 'video', 'audio', 'file'
      fileName: fileName || null,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      readBy: [{
        userId: new ObjectId(userId),
        readAt: new Date()
      }],
      createdAt: new Date()
    };

    const result = await db.collection('chatMessages').insertOne(message);
    message._id = result.insertedId;

    // Emit to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('new-chat-message', message);

    // Send push notifications to other members
    const otherMemberIds = jointAccount.members
      .filter(m => m.userId.toString() !== userId.toString())
      .map(m => m.userId.toString());

    // Create a preview message for notifications
    let previewMessage = content;
    if (type === 'image') previewMessage = '📷 Sent an image';
    else if (type === 'video') previewMessage = '🎥 Sent a video';
    else if (type === 'audio') previewMessage = '🎵 Sent an audio';
    else if (type === 'file') previewMessage = `📎 Sent a file: ${fileName}`;

    await sendChatPushNotification(
      otherMemberIds,
      sender.name,
      previewMessage,
      jointAccount.name,
      jointAccountId,
      db
    );

    // Create in-app notifications for members not currently viewing
    for (const memberId of otherMemberIds) {
      await db.collection('notifications').insertOne({
        userId: new ObjectId(memberId),
        type: 'chat_message',
        title: `New message in ${jointAccount.name}`,
        message: `${sender.name}: ${previewMessage}`,
        data: {
          jointAccountId,
          messageId: message._id.toString()
        },
        read: false,
        createdAt: new Date()
      });
    }

    // Emit notification count update
    for (const memberId of otherMemberIds) {
      io.to(`user:${memberId}`).emit('chat-notification', {
        jointAccountId,
        message
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/chat/:jointAccountId/read - Mark all messages as read
router.post('/:jointAccountId/read', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Mark all unread messages as read
    await db.collection('chatMessages').updateMany(
      {
        jointAccountId: new ObjectId(jointAccountId),
        'readBy.userId': { $ne: new ObjectId(userId) },
        senderId: { $ne: new ObjectId(userId) }
      },
      {
        $push: {
          readBy: {
            userId: new ObjectId(userId),
            readAt: new Date()
          }
        }
      }
    );

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// DELETE /api/chat/:jointAccountId/messages/:messageId - Delete a message
router.delete('/:jointAccountId/messages/:messageId', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { jointAccountId, messageId } = req.params;

    // Verify user is a member with appropriate role
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    const message = await db.collection('chatMessages').findOne({
      _id: new ObjectId(messageId),
      jointAccountId: new ObjectId(jointAccountId)
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Only sender or admin/owner can delete
    const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    const canDelete = message.senderId.toString() === userId.toString() || 
                      ['owner', 'admin'].includes(member?.role);

    if (!canDelete) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    await db.collection('chatMessages').deleteOne({ _id: new ObjectId(messageId) });

    // Emit delete to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('chat-message-deleted', { messageId });

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// DELETE /api/chat/:jointAccountId - Delete entire conversation (owner/admin only)
router.delete('/:jointAccountId', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { jointAccountId } = req.params;

    // Verify user is a member with owner or admin role
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Check if user is owner or admin
    const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    if (!['owner', 'admin'].includes(member?.role)) {
      return res.status(403).json({ error: 'Only owner or admin can delete the conversation' });
    }

    // Delete all messages in this conversation
    const deleteResult = await db.collection('chatMessages').deleteMany({
      jointAccountId: new ObjectId(jointAccountId)
    });

    // Emit to socket room that conversation was deleted
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('chat-conversation-deleted', { jointAccountId });

    res.json({ 
      message: 'Conversation deleted',
      deletedMessages: deleteResult.deletedCount 
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// GET /api/chat/unread-count - Get total unread count across all conversations
router.get('/unread-count', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    // Get all joint accounts user is a member of
    const jointAccounts = await db.collection('jointAccounts')
      .find({ 'members.userId': new ObjectId(userId) })
      .toArray();

    const jointAccountIds = jointAccounts.map(ja => ja._id);

    // Get total unread count
    const unreadCount = await db.collection('chatMessages')
      .countDocuments({
        jointAccountId: { $in: jointAccountIds },
        'readBy.userId': { $ne: new ObjectId(userId) },
        senderId: { $ne: new ObjectId(userId) }
      });

    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// POST /api/chat/:jointAccountId/share-transaction - Share a transaction to chat
router.post('/:jointAccountId/share-transaction', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { transactionId, comment } = req.body;

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Get the transaction
    const transaction = await db.collection('transactions').findOne({
      _id: new ObjectId(transactionId),
      jointAccountId: new ObjectId(jointAccountId)
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Get sender info
    const sender = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    // Create transaction share message
    const message = {
      jointAccountId: new ObjectId(jointAccountId),
      senderId: new ObjectId(userId),
      senderName: sender.name,
      senderImage: sender.image,
      content: comment || '',
      type: 'transaction_share',
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

    const result = await db.collection('chatMessages').insertOne(message);
    message._id = result.insertedId;

    // Emit to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('new-chat-message', message);

    // Send push notifications
    const otherMemberIds = jointAccount.members
      .filter(m => m.userId.toString() !== userId.toString())
      .map(m => m.userId.toString());

    const emoji = transaction.type === 'INCOME' ? '💰' : '💸';
    await sendChatPushNotification(
      otherMemberIds,
      sender.name,
      `${emoji} Shared a ${transaction.type.toLowerCase()}: ${transaction.category}`,
      jointAccount.name,
      jointAccountId,
      db
    );

    res.status(201).json(message);
  } catch (error) {
    console.error('Share transaction error:', error);
    res.status(500).json({ error: 'Failed to share transaction' });
  }
});

// POST /api/chat/:jointAccountId/split-request - Create a split expense request
router.post('/:jointAccountId/split-request', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { amount, description, splitWith, transactionId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Get sender info
    const sender = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    // Calculate split amount per person
    const splitMembers = splitWith || jointAccount.members
      .filter(m => m.userId.toString() !== userId.toString())
      .map(m => m.userId.toString());
    
    const splitAmount = parseFloat((amount / (splitMembers.length + 1)).toFixed(2));

    // Create split request
    const splitRequest = {
      jointAccountId: new ObjectId(jointAccountId),
      requesterId: new ObjectId(userId),
      requesterName: sender.name,
      totalAmount: parseFloat(amount),
      splitAmount,
      description: description || 'Split expense',
      transactionId: transactionId ? new ObjectId(transactionId) : null,
      participants: splitMembers.map(memberId => ({
        userId: new ObjectId(memberId),
        amount: splitAmount,
        status: 'pending', // pending, paid, declined
        respondedAt: null
      })),
      status: 'active', // active, completed, cancelled
      createdAt: new Date()
    };

    const splitResult = await db.collection('splitRequests').insertOne(splitRequest);
    splitRequest._id = splitResult.insertedId;

    // Create chat message for split request
    const message = {
      jointAccountId: new ObjectId(jointAccountId),
      senderId: new ObjectId(userId),
      senderName: sender.name,
      senderImage: sender.image,
      content: description || 'Split expense',
      type: 'split_request',
      splitRequestId: splitResult.insertedId,
      splitData: {
        totalAmount: parseFloat(amount),
        splitAmount,
        participantCount: splitMembers.length,
        description: description || 'Split expense'
      },
      readBy: [{
        userId: new ObjectId(userId),
        readAt: new Date()
      }],
      createdAt: new Date()
    };

    const msgResult = await db.collection('chatMessages').insertOne(message);
    message._id = msgResult.insertedId;

    // Emit to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('new-chat-message', message);

    // Send push notifications
    await sendChatPushNotification(
      splitMembers,
      sender.name,
      `💳 Requesting ₱${splitAmount.toLocaleString()} from you for: ${description || 'Split expense'}`,
      jointAccount.name,
      jointAccountId,
      db
    );

    res.status(201).json({ splitRequest, message });
  } catch (error) {
    console.error('Split request error:', error);
    res.status(500).json({ error: 'Failed to create split request' });
  }
});

// POST /api/chat/split-request/:splitRequestId/respond - Respond to split request
router.post('/split-request/:splitRequestId/respond', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const splitRequestId = req.params.splitRequestId;
    const { action } = req.body; // 'pay' or 'decline'

    if (!['pay', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const splitRequest = await db.collection('splitRequests').findOne({
      _id: new ObjectId(splitRequestId)
    });

    if (!splitRequest) {
      return res.status(404).json({ error: 'Split request not found' });
    }

    // Find user's participation
    const participantIndex = splitRequest.participants.findIndex(
      p => p.userId.toString() === userId.toString()
    );

    if (participantIndex === -1) {
      return res.status(403).json({ error: 'You are not part of this split request' });
    }

    // Update participant status
    const updatePath = `participants.${participantIndex}`;
    await db.collection('splitRequests').updateOne(
      { _id: new ObjectId(splitRequestId) },
      {
        $set: {
          [`${updatePath}.status`]: action === 'pay' ? 'paid' : 'declined',
          [`${updatePath}.respondedAt`]: new Date()
        }
      }
    );

    // Check if all participants have responded
    const updatedSplitRequest = await db.collection('splitRequests').findOne({
      _id: new ObjectId(splitRequestId)
    });

    const allResponded = updatedSplitRequest.participants.every(p => p.status !== 'pending');
    if (allResponded) {
      await db.collection('splitRequests').updateOne(
        { _id: new ObjectId(splitRequestId) },
        { $set: { status: 'completed' } }
      );
    }

    // Get user info
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    // Create system message about the response
    const jointAccountId = splitRequest.jointAccountId;
    const message = {
      jointAccountId,
      senderId: new ObjectId(userId),
      senderName: user.name,
      senderImage: user.image,
      content: action === 'pay' 
        ? `✅ ${user.name} paid ₱${splitRequest.splitAmount.toLocaleString()} for "${splitRequest.description}"`
        : `❌ ${user.name} declined the split request for "${splitRequest.description}"`,
      type: 'system',
      readBy: [{
        userId: new ObjectId(userId),
        readAt: new Date()
      }],
      createdAt: new Date()
    };

    await db.collection('chatMessages').insertOne(message);

    // Emit to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('new-chat-message', message);
    io.to(`joint:${jointAccountId}`).emit('split-request-updated', { splitRequestId, action, userId });

    res.json({ message: `Split request ${action === 'pay' ? 'paid' : 'declined'}` });
  } catch (error) {
    console.error('Split response error:', error);
    res.status(500).json({ error: 'Failed to respond to split request' });
  }
});

// GET /api/chat/:jointAccountId/leaderboard - Get contribution leaderboard
router.get('/:jointAccountId/leaderboard', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { period = 'month' } = req.query; // 'week', 'month', 'all'

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Calculate date range
    const now = new Date();
    let startDate;
    if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      startDate = new Date(0); // All time
    }

    // Aggregate transactions by user
    const leaderboard = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalIncome: {
            $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] }
          },
          totalExpense: {
            $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] }
          },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { totalIncome: -1 } }
    ]).toArray();

    // Get user details
    const userIds = leaderboard.map(l => l._id);
    const users = await db.collection('users')
      .find({ _id: { $in: userIds } })
      .project({ name: 1, image: 1 })
      .toArray();

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = u;
    });

    const enrichedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      userId: entry._id,
      name: userMap[entry._id.toString()]?.name || 'Unknown',
      image: userMap[entry._id.toString()]?.image || null,
      totalIncome: entry.totalIncome,
      totalExpense: entry.totalExpense,
      netContribution: entry.totalIncome - entry.totalExpense,
      transactionCount: entry.transactionCount
    }));

    res.json({ leaderboard: enrichedLeaderboard, period });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// POST /api/chat/:jointAccountId/post-leaderboard - Post leaderboard to chat
router.post('/:jointAccountId/post-leaderboard', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { period = 'month' } = req.body;

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Get leaderboard data
    const now = new Date();
    let startDate;
    let periodLabel;
    if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      periodLabel = 'This Week';
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      periodLabel = now.toLocaleString('default', { month: 'long' });
    } else {
      startDate = new Date(0);
      periodLabel = 'All Time';
    }

    const leaderboard = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalIncome: {
            $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] }
          },
          totalExpense: {
            $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] }
          }
        }
      },
      { $sort: { totalIncome: -1 } },
      { $limit: 5 }
    ]).toArray();

    // Get user details
    const userIds = leaderboard.map(l => l._id);
    const users = await db.collection('users')
      .find({ _id: { $in: userIds } })
      .project({ name: 1 })
      .toArray();

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = u.name;
    });

    // Get sender info
    const sender = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    // Create leaderboard message
    const message = {
      jointAccountId: new ObjectId(jointAccountId),
      senderId: new ObjectId(userId),
      senderName: sender.name,
      senderImage: sender.image,
      content: `🏆 Contribution Leaderboard - ${periodLabel}`,
      type: 'leaderboard',
      leaderboardData: {
        period,
        periodLabel,
        entries: leaderboard.map((entry, index) => ({
          rank: index + 1,
          userId: entry._id,
          name: userMap[entry._id.toString()] || 'Unknown',
          totalIncome: entry.totalIncome,
          totalExpense: entry.totalExpense,
          netContribution: entry.totalIncome - entry.totalExpense
        }))
      },
      readBy: [{
        userId: new ObjectId(userId),
        readAt: new Date()
      }],
      createdAt: new Date()
    };

    const result = await db.collection('chatMessages').insertOne(message);
    message._id = result.insertedId;

    // Emit to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('new-chat-message', message);

    res.status(201).json(message);
  } catch (error) {
    console.error('Post leaderboard error:', error);
    res.status(500).json({ error: 'Failed to post leaderboard' });
  }
});

// GET /api/chat/:jointAccountId/monthly-recap - Get monthly recap
router.get('/:jointAccountId/monthly-recap', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { month, year } = req.query;

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Calculate date range
    const now = new Date();
    const targetMonth = month ? parseInt(month) : now.getMonth();
    const targetYear = year ? parseInt(year) : now.getFullYear();
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

    // Get stats
    const stats = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] }
          },
          totalExpense: {
            $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] }
          },
          transactionCount: { $sum: 1 }
        }
      }
    ]).toArray();

    // Get top contributor
    const topContributor = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate, $lte: endDate },
          type: 'INCOME'
        }
      },
      {
        $group: {
          _id: '$userId',
          total: { $sum: '$amount' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]).toArray();

    // Get top expense category
    const topExpenseCategory = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate, $lte: endDate },
          type: 'EXPENSE'
        }
      },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]).toArray();

    // Get top contributor name
    let topContributorName = null;
    if (topContributor.length > 0) {
      const user = await db.collection('users').findOne(
        { _id: topContributor[0]._id },
        { projection: { name: 1 } }
      );
      topContributorName = user?.name;
    }

    const monthName = new Date(targetYear, targetMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

    res.json({
      month: monthName,
      totalIncome: stats[0]?.totalIncome || 0,
      totalExpense: stats[0]?.totalExpense || 0,
      balance: (stats[0]?.totalIncome || 0) - (stats[0]?.totalExpense || 0),
      transactionCount: stats[0]?.transactionCount || 0,
      topContributor: topContributorName ? {
        name: topContributorName,
        amount: topContributor[0].total
      } : null,
      topExpenseCategory: topExpenseCategory.length > 0 ? {
        category: topExpenseCategory[0]._id,
        amount: topExpenseCategory[0].total
      } : null
    });
  } catch (error) {
    console.error('Monthly recap error:', error);
    res.status(500).json({ error: 'Failed to get monthly recap' });
  }
});

// POST /api/chat/:jointAccountId/post-recap - Post monthly recap to chat
router.post('/:jointAccountId/post-recap', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Get current month recap
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const stats = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] }
          },
          totalExpense: {
            $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] }
          },
          transactionCount: { $sum: 1 }
        }
      }
    ]).toArray();

    // Get top contributor
    const topContributor = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate, $lte: endDate },
          type: 'INCOME'
        }
      },
      {
        $group: {
          _id: '$userId',
          total: { $sum: '$amount' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]).toArray();

    // Get top expense category
    const topExpenseCategory = await db.collection('transactions').aggregate([
      {
        $match: {
          jointAccountId: new ObjectId(jointAccountId),
          date: { $gte: startDate, $lte: endDate },
          type: 'EXPENSE'
        }
      },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]).toArray();

    // Get top contributor name
    let topContributorName = null;
    let topContributorAmount = 0;
    if (topContributor.length > 0) {
      const user = await db.collection('users').findOne(
        { _id: topContributor[0]._id },
        { projection: { name: 1 } }
      );
      topContributorName = user?.name;
      topContributorAmount = topContributor[0].total;
    }

    // Get sender info
    const sender = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Create recap message
    const message = {
      jointAccountId: new ObjectId(jointAccountId),
      senderId: new ObjectId(userId),
      senderName: sender.name,
      senderImage: sender.image,
      content: `📊 Monthly Recap - ${monthName}`,
      type: 'monthly_recap',
      recapData: {
        month: monthName,
        totalIncome: stats[0]?.totalIncome || 0,
        totalExpense: stats[0]?.totalExpense || 0,
        balance: (stats[0]?.totalIncome || 0) - (stats[0]?.totalExpense || 0),
        transactionCount: stats[0]?.transactionCount || 0,
        topContributor: topContributorName ? {
          name: topContributorName,
          amount: topContributorAmount
        } : null,
        topExpenseCategory: topExpenseCategory.length > 0 ? {
          category: topExpenseCategory[0]._id,
          amount: topExpenseCategory[0].total
        } : null
      },
      readBy: [{
        userId: new ObjectId(userId),
        readAt: new Date()
      }],
      createdAt: new Date()
    };

    const result = await db.collection('chatMessages').insertOne(message);
    message._id = result.insertedId;

    // Emit to socket room
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('new-chat-message', message);

    res.status(201).json(message);
  } catch (error) {
    console.error('Post recap error:', error);
    res.status(500).json({ error: 'Failed to post recap' });
  }
});

// POST /api/chat/:jointAccountId/command - Handle quick commands
router.post('/:jointAccountId/command', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.jointAccountId;
    const { command } = req.body;

    // Verify user is a member
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    // Get sender info
    const sender = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, image: 1 } }
    );

    const io = req.app.get('io');
    let responseMessage = null;

    // Parse command
    const parts = command.toLowerCase().trim().split(' ');
    const cmd = parts[0];

    if (cmd === '/balance' || cmd === '/bal') {
      // Get current balance
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const stats = await db.collection('transactions').aggregate([
        {
          $match: {
            jointAccountId: new ObjectId(jointAccountId),
            date: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
            expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } }
          }
        }
      ]).toArray();

      const income = stats[0]?.income || 0;
      const expense = stats[0]?.expense || 0;

      responseMessage = {
        jointAccountId: new ObjectId(jointAccountId),
        senderId: null,
        senderName: 'FlowMoney Bot',
        senderImage: null,
        content: `💰 **${jointAccount.name} Balance**\n\n📈 Income: ₱${income.toLocaleString()}\n📉 Expense: ₱${expense.toLocaleString()}\n💵 Balance: ₱${(income - expense).toLocaleString()}`,
        type: 'system',
        readBy: [],
        createdAt: new Date()
      };

    } else if (cmd === '/summary' || cmd === '/stats') {
      // Get quick summary
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const transactionCount = await db.collection('transactions').countDocuments({
        jointAccountId: new ObjectId(jointAccountId),
        date: { $gte: startDate }
      });

      const stats = await db.collection('transactions').aggregate([
        {
          $match: {
            jointAccountId: new ObjectId(jointAccountId),
            date: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amount', 0] } },
            expense: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amount', 0] } }
          }
        }
      ]).toArray();

      const monthName = now.toLocaleString('default', { month: 'long' });

      responseMessage = {
        jointAccountId: new ObjectId(jointAccountId),
        senderId: null,
        senderName: 'FlowMoney Bot',
        senderImage: null,
        content: `📊 **${monthName} Summary**\n\n📝 Transactions: ${transactionCount}\n📈 Income: ₱${(stats[0]?.income || 0).toLocaleString()}\n📉 Expenses: ₱${(stats[0]?.expense || 0).toLocaleString()}\n👥 Members: ${jointAccount.members.length}`,
        type: 'system',
        readBy: [],
        createdAt: new Date()
      };

    } else if (cmd === '/add') {
      // Quick add: /add 500 Food lunch
      const amount = parseFloat(parts[1]);
      const category = parts[2] || 'Other';
      const note = parts.slice(3).join(' ') || '';

      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Usage: /add [amount] [category] [note]' });
      }

      // Check permission
      const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
      if (member?.role === 'viewer') {
        return res.status(403).json({ error: 'You have view-only access' });
      }

      // Create transaction
      const transaction = {
        userId: new ObjectId(userId),
        jointAccountId: new ObjectId(jointAccountId),
        amount,
        currency: 'PHP',
        type: 'EXPENSE',
        category: category.charAt(0).toUpperCase() + category.slice(1),
        note,
        date: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('transactions').insertOne(transaction);

      responseMessage = {
        jointAccountId: new ObjectId(jointAccountId),
        senderId: new ObjectId(userId),
        senderName: sender.name,
        senderImage: sender.image,
        content: `💸 ${sender.name} added expense via command`,
        type: 'transaction_share',
        transactionData: {
          amount,
          currency: 'PHP',
          type: 'EXPENSE',
          category: category.charAt(0).toUpperCase() + category.slice(1),
          note,
          date: new Date()
        },
        readBy: [{
          userId: new ObjectId(userId),
          readAt: new Date()
        }],
        createdAt: new Date()
      };

      // Emit transaction created
      io.to(`joint:${jointAccountId}`).emit('transaction-created', transaction);

    } else if (cmd === '/income') {
      // Quick add income: /income 5000 Salary
      const amount = parseFloat(parts[1]);
      const category = parts[2] || 'Other';
      const note = parts.slice(3).join(' ') || '';

      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Usage: /income [amount] [category] [note]' });
      }

      // Check permission
      const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
      if (member?.role === 'viewer') {
        return res.status(403).json({ error: 'You have view-only access' });
      }

      // Create transaction
      const transaction = {
        userId: new ObjectId(userId),
        jointAccountId: new ObjectId(jointAccountId),
        amount,
        currency: 'PHP',
        type: 'INCOME',
        category: category.charAt(0).toUpperCase() + category.slice(1),
        note,
        date: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('transactions').insertOne(transaction);

      responseMessage = {
        jointAccountId: new ObjectId(jointAccountId),
        senderId: new ObjectId(userId),
        senderName: sender.name,
        senderImage: sender.image,
        content: `💰 ${sender.name} added income via command`,
        type: 'transaction_share',
        transactionData: {
          amount,
          currency: 'PHP',
          type: 'INCOME',
          category: category.charAt(0).toUpperCase() + category.slice(1),
          note,
          date: new Date()
        },
        readBy: [{
          userId: new ObjectId(userId),
          readAt: new Date()
        }],
        createdAt: new Date()
      };

      // Emit transaction created
      io.to(`joint:${jointAccountId}`).emit('transaction-created', transaction);

    } else if (cmd === '/help') {
      responseMessage = {
        jointAccountId: new ObjectId(jointAccountId),
        senderId: null,
        senderName: 'FlowMoney Bot',
        senderImage: null,
        content: `🤖 **Available Commands**\n\n/balance - Show current balance\n/summary - Monthly summary\n/add [amount] [category] [note] - Quick expense\n/income [amount] [category] [note] - Quick income\n/help - Show this help`,
        type: 'system',
        readBy: [],
        createdAt: new Date()
      };
    } else {
      return res.status(400).json({ error: 'Unknown command. Type /help for available commands.' });
    }

    if (responseMessage) {
      const result = await db.collection('chatMessages').insertOne(responseMessage);
      responseMessage._id = result.insertedId;
      io.to(`joint:${jointAccountId}`).emit('new-chat-message', responseMessage);
    }

    res.status(201).json(responseMessage);
  } catch (error) {
    console.error('Command error:', error);
    res.status(500).json({ error: 'Failed to process command' });
  }
});

module.exports = router;
