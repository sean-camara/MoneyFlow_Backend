import { Router } from 'express';
import { createAuthMiddleware } from '../middleware/auth.js';
import { 
  getVapidPublicKey, 
  savePushSubscription, 
  removePushSubscription,
  sendPushNotification
} from '../services/pushService.js';
import { Auth } from '../config/auth.js';
import { getDb } from '../config/database.js';

export function createPushRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Get VAPID public key for client subscription
  router.get('/vapid-public-key', (req, res) => {
    const publicKey = getVapidPublicKey();
    
    if (!publicKey) {
      return res.status(503).json({ 
        success: false, 
        error: 'Push notifications not configured' 
      });
    }

    res.json({ success: true, data: { publicKey } });
  });

  // Subscribe to push notifications (supports both FCM token and VAPID subscription)
  router.post('/subscribe', authMiddleware, async (req, res) => {
    try {
      const userId = req.user!.id;
      const userEmail = req.user!.email;
      const { subscription, token, platform } = req.body;

      console.log('=== SUBSCRIBE REQUEST ===');
      console.log('User ID:', userId);
      console.log('User Email:', userEmail);

      // Handle FCM token (new Firebase method)
      if (token) {
        console.log('FCM Token received:', token.substring(0, 20) + '...');
        await savePushSubscription(userId, {
          fcmToken: token,
          platform: platform || 'web',
          type: 'fcm'
        });
        console.log('=== FCM TOKEN SAVED ===');
        return res.json({ success: true, message: 'FCM token saved' });
      }

      // Handle legacy VAPID subscription
      if (subscription && subscription.endpoint && subscription.keys) {
        console.log('Legacy VAPID subscription:', JSON.stringify(subscription));
        await savePushSubscription(userId, {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth
          },
          type: 'vapid'
        });
        console.log('=== VAPID SUBSCRIPTION SAVED ===');
        return res.json({ success: true, message: 'Push subscription saved' });
      }

      console.log('ERROR: Invalid subscription data');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid subscription data - need token or subscription' 
      });
    } catch (error) {
      console.error('Error saving push subscription:', error);
      res.status(500).json({ success: false, error: 'Failed to save subscription' });
    }
  });

  // Unsubscribe from push notifications
  router.post('/unsubscribe', authMiddleware, async (req, res) => {
    try {
      const userId = req.user!.id;

      await removePushSubscription(userId);

      res.json({ success: true, message: 'Push subscription removed' });
    } catch (error) {
      console.error('Error removing push subscription:', error);
      res.status(500).json({ success: false, error: 'Failed to remove subscription' });
    }
  });

  // Send test notification to current user
  router.post('/test', authMiddleware, async (req, res) => {
    try {
      const userId = req.user!.id;
      const userEmail = req.user!.email;
      const db = getDb();
      
      console.log('=== TEST NOTIFICATION ===');
      console.log('User ID:', userId);
      console.log('User Email:', userEmail);
      
      let subscriptionData = null;
      
      // Try to find subscription in user collection first
      const user = await db.collection('user').findOne({ id: userId });
      if (user?.pushSubscription) {
        console.log('Found subscription in user collection');
        subscriptionData = user.pushSubscription;
      }
      
      // If not found, check pushSubscriptions collection
      if (!subscriptionData) {
        const pushSub = await db.collection('pushSubscriptions').findOne({ userId: userId });
        if (pushSub?.subscription) {
          console.log('Found subscription in pushSubscriptions collection');
          subscriptionData = pushSub.subscription;
        }
      }
      
      // If still not found, try by email
      if (!subscriptionData) {
        const userByEmail = await db.collection('user').findOne({ email: userEmail });
        if (userByEmail?.pushSubscription) {
          console.log('Found subscription by email');
          subscriptionData = userByEmail.pushSubscription;
        }
      }
      
      if (!subscriptionData) {
        console.log('No subscription found anywhere');
        return res.status(400).json({ 
          success: false, 
          error: 'No push subscription found. Please toggle notifications off and on again.' 
        });
      }

      const subscription = typeof subscriptionData === 'string' 
        ? JSON.parse(subscriptionData) 
        : subscriptionData;

      console.log('Sending push to endpoint:', subscription.endpoint);

      const payload = {
        title: 'FlowMoney Test 🎉',
        body: 'This is a real push notification from the server!',
        icon: '/icon-192.png',
        tag: 'test-server-' + Date.now(),
        data: { type: 'test' }
      };

      const success = await sendPushNotification(subscription, payload);
      
      if (success) {
        console.log('Push notification sent successfully!');
        res.json({ success: true, message: 'Test notification sent!' });
      } else {
        console.log('Push notification failed');
        res.status(500).json({ success: false, error: 'Failed to send notification' });
      }
    } catch (error) {
      console.error('Error sending test notification:', error);
      res.status(500).json({ success: false, error: 'Failed to send test notification' });
    }
  });

  return router;
}
