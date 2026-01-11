const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');
const admin = require('firebase-admin');

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    const notifications = await db.collection('notifications')
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Get unread count
    const unreadCount = await db.collection('notifications')
      .countDocuments({ 
        userId: new ObjectId(userId), 
        read: false 
      });

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const notificationId = req.params.id;

    const result = await db.collection('notifications').updateOne(
      { 
        _id: new ObjectId(notificationId), 
        userId: new ObjectId(userId) 
      },
      { $set: { read: true, readAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    await db.collection('notifications').updateMany(
      { userId: new ObjectId(userId), read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// POST /api/notifications/:id/action - Handle notification action (accept/decline invite)
router.post('/:id/action', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const notificationId = req.params.id;
    const { action } = req.body; // 'accept' or 'decline'

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be accept or decline' });
    }

    // Get the notification
    const notification = await db.collection('notifications').findOne({
      _id: new ObjectId(notificationId),
      userId: new ObjectId(userId),
      type: 'joint_account_invite'
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.actionTaken) {
      return res.status(400).json({ error: 'Action already taken on this invite' });
    }

    const jointAccountId = notification.data?.jointAccountId;

    if (action === 'accept') {
      // Add user to joint account
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: new ObjectId(jointAccountId)
      });

      if (!jointAccount) {
        return res.status(404).json({ error: 'Joint account no longer exists' });
      }

      // Check if user is already a member
      const isMember = jointAccount.members.some(
        m => m.userId.toString() === userId.toString()
      );

      if (isMember) {
        return res.status(400).json({ error: 'You are already a member of this account' });
      }

      // Add user as editor (can add/edit/delete transactions)
      await db.collection('jointAccounts').updateOne(
        { _id: new ObjectId(jointAccountId) },
        {
          $push: {
            members: {
              userId: new ObjectId(userId),
              role: 'editor',
              joinedAt: new Date()
            }
          },
          $set: { updatedAt: new Date() }
        }
      );

      // Get inviter info to send them a notification
      const inviter = await db.collection('users').findOne(
        { _id: new ObjectId(notification.data.invitedBy) },
        { projection: { name: 1, email: 1 } }
      );
      
      const currentUser = await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { name: 1, email: 1 } }
      );

      // Notify the inviter that their invite was accepted
      await db.collection('notifications').insertOne({
        userId: new ObjectId(notification.data.invitedBy),
        type: 'invite_accepted',
        title: 'Invite Accepted',
        message: `${currentUser.name} has accepted your invite to join "${jointAccount.name}"`,
        data: {
          jointAccountId,
          acceptedBy: userId,
          acceptedByName: currentUser.name
        },
        read: false,
        createdAt: new Date()
      });

      // Send push notification to inviter
      await sendPushNotification(
        notification.data.invitedBy, 
        'Invite Accepted', 
        `${currentUser.name} has joined "${jointAccount.name}"`,
        db
      );
    }

    // Mark notification as actioned
    await db.collection('notifications').updateOne(
      { _id: new ObjectId(notificationId) },
      { 
        $set: { 
          actionTaken: action, 
          actionTakenAt: new Date(),
          read: true,
          readAt: new Date()
        } 
      }
    );

    res.json({ 
      message: action === 'accept' 
        ? 'You have joined the joint account' 
        : 'Invite declined'
    });
  } catch (error) {
    console.error('Notification action error:', error);
    res.status(500).json({ error: 'Failed to process action' });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const notificationId = req.params.id;

    const result = await db.collection('notifications').deleteOne({
      _id: new ObjectId(notificationId),
      userId: new ObjectId(userId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Helper function to send push notification
async function sendPushNotification(userId, title, body, db) {
  try {
    const subscriptions = await db.collection('pushSubscriptions')
      .find({ userId: new ObjectId(userId) })
      .toArray();

    if (subscriptions.length === 0) return;

    const tokens = subscriptions.map(s => s.fcmToken);

    const message = {
      notification: { title, body },
      tokens
    };

    await admin.messaging().sendEachForMulticast(message);
  } catch (error) {
    console.error('Push notification error:', error);
  }
}

module.exports = router;
