const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');
const admin = require('firebase-admin');

const router = express.Router();

// POST /api/push/subscribe - Register FCM token
router.post('/subscribe', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    // Upsert subscription
    await db.collection('pushSubscriptions').updateOne(
      { fcmToken },
      {
        $set: {
          userId: new ObjectId(userId),
          fcmToken,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ message: 'Subscribed to push notifications' });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// POST /api/push/unsubscribe - Remove FCM token
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const db = getDB();
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    await db.collection('pushSubscriptions').deleteOne({ fcmToken });

    res.json({ message: 'Unsubscribed from push notifications' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// POST /api/push/test - Send test notification
router.post('/test', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    // Get user's FCM tokens
    const subscriptions = await db.collection('pushSubscriptions')
      .find({ userId: new ObjectId(userId) })
      .toArray();

    if (subscriptions.length === 0) {
      return res.status(400).json({ error: 'No push subscriptions found' });
    }

    const tokens = subscriptions.map(s => s.fcmToken);

    // Send test notification
    const message = {
      notification: {
        title: '🎉 FlowMoney Test',
        body: 'Push notifications are working!'
      },
      data: {
        type: 'test',
        timestamp: new Date().toISOString()
      },
      tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Remove invalid tokens
    const invalidTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        invalidTokens.push(tokens[idx]);
      }
    });

    if (invalidTokens.length > 0) {
      await db.collection('pushSubscriptions').deleteMany({
        fcmToken: { $in: invalidTokens }
      });
    }

    res.json({
      message: 'Test notification sent',
      successCount: response.successCount,
      failureCount: response.failureCount
    });
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Helper function to send notification to a user (used internally)
const sendNotificationToUser = async (userId, title, body, data = {}) => {
  try {
    const db = getDB();
    
    const subscriptions = await db.collection('pushSubscriptions')
      .find({ userId: new ObjectId(userId) })
      .toArray();

    if (subscriptions.length === 0) return { sent: false };

    const tokens = subscriptions.map(s => s.fcmToken);

    const message = {
      notification: { title, body },
      data: {
        ...data,
        timestamp: new Date().toISOString()
      },
      tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    return { sent: true, successCount: response.successCount };
  } catch (error) {
    console.error('Send notification error:', error);
    return { sent: false, error: error.message };
  }
};

module.exports = router;
module.exports.sendNotificationToUser = sendNotificationToUser;
