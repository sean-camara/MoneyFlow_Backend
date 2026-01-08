import webPush from 'web-push';
import { getDb } from '../config/database.js';
import { PushSubscriptionData, NotificationPayload, JointAccountMember } from '../types/index.js';
import { sendFcmNotification, isFirebaseInitialized } from './firebaseService.js';

// Initialize web-push with VAPID keys
export function initializePushService(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@flowmoney.app';

  if (!publicKey || !privateKey) {
    console.warn('⚠️ VAPID keys not configured. Legacy push notifications will not work.');
    console.warn('Run: npm run generate-vapid to generate keys');
  } else {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    console.log('✅ Legacy VAPID push service initialized');
  }
}

// Get VAPID public key for client subscription
export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}

// Send push notification - tries FCM first, then falls back to VAPID
export async function sendPushNotification(
  subscription: PushSubscriptionData | any,
  payload: NotificationPayload
): Promise<boolean> {
  // Check if this is an FCM subscription (has fcmToken)
  if (subscription.fcmToken) {
    console.log('📱 Sending FCM push notification');
    const dataPayload: Record<string, string> = {};
    if (payload.tag) dataPayload.tag = payload.tag;
    if (payload.data) {
      Object.entries(payload.data).forEach(([key, value]) => {
        dataPayload[key] = String(value);
      });
    }
    return await sendFcmNotification(subscription.fcmToken, {
      title: payload.title,
      body: payload.body,
      icon: payload.icon,
      data: dataPayload
    });
  }

  // Fall back to VAPID web-push
  if (!subscription.endpoint || !subscription.keys) {
    console.warn('Invalid subscription format - no FCM token or VAPID keys');
    return false;
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('VAPID push notifications not configured');
    return false;
  }

  try {
    console.log('📱 Sending VAPID push notification');
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload)
    );
    return true;
  } catch (error: any) {
    console.error('Failed to send VAPID push notification:', error.message);
    
    // If subscription is no longer valid, we should remove it
    if (error.statusCode === 410) {
      console.log('Subscription expired, should be removed');
    }
    
    return false;
  }
}

// Send notification to a user by userId
export async function sendNotificationToUser(
  userId: string,
  payload: NotificationPayload
): Promise<boolean> {
  const db = getDb();
  
  // Find user with push subscription
  const user = await db.collection('user').findOne({
    id: userId,
    notificationsEnabled: true,
    pushSubscription: { $exists: true, $ne: null }
  });

  if (!user?.pushSubscription) {
    console.log(`No push subscription for user ${userId}`);
    return false;
  }

  try {
    const subscription = typeof user.pushSubscription === 'string'
      ? JSON.parse(user.pushSubscription)
      : user.pushSubscription;
    
    return await sendPushNotification(subscription, payload);
  } catch (e) {
    console.error('Error sending notification to user:', userId, e);
    return false;
  }
}

// Notify all members of a joint account except the actor
export async function notifyJointAccountMembers(
  jointAccountId: string,
  excludeUserId: string,
  payload: NotificationPayload
): Promise<void> {
  const db = getDb();
  
  // Get all members of the joint account
  const members = await db.collection<JointAccountMember>('jointAccountMembers')
    .find({ jointAccountId })
    .toArray();
  
  // Get user details for members (except the one who triggered the action)
  const userIds = members
    .filter(m => m.userId !== excludeUserId)
    .map(m => m.userId);
  
  if (userIds.length === 0) return;
  
  console.log(`📢 Notifying ${userIds.length} joint account members`);
  
  // Get users with push subscriptions
  const users = await db.collection('user')
    .find({
      id: { $in: userIds },
      notificationsEnabled: true,
      pushSubscription: { $exists: true, $ne: null }
    })
    .toArray();
  
  console.log(`📱 ${users.length} users have push subscriptions enabled`);
  
  // Send notifications to all eligible users
  const notifications = users.map(async (user) => {
    if (user.pushSubscription) {
      try {
        const subscription = typeof user.pushSubscription === 'string' 
          ? JSON.parse(user.pushSubscription) 
          : user.pushSubscription;
        const success = await sendPushNotification(subscription, payload);
        if (success) {
          console.log(`✅ Notification sent to user ${user.id}`);
        }
      } catch (e) {
        console.error('Error sending notification to user:', user.id, e);
      }
    }
  });
  
  await Promise.allSettled(notifications);
}

// Save push subscription for a user
export async function savePushSubscription(
  userId: string,
  subscription: PushSubscriptionData
): Promise<void> {
  const db = getDb();
  
  console.log('Saving push subscription for user:', userId);
  
  // Better Auth stores users with 'id' field, try to update
  const result = await db.collection('user').updateOne(
    { id: userId },
    { 
      $set: { 
        pushSubscription: JSON.stringify(subscription),
        notificationsEnabled: true,
        updatedAt: new Date()
      } 
    }
  );
  
  console.log('Update by id result:', result.matchedCount, 'matched,', result.modifiedCount, 'modified');
  
  // If no document was matched by id, try by _id (ObjectId)
  if (result.matchedCount === 0) {
    console.log('No user found with id field, trying _id...');
    
    // Try with ObjectId
    const { ObjectId } = await import('mongodb');
    try {
      const result2 = await db.collection('user').updateOne(
        { _id: new ObjectId(userId) },
        { 
          $set: { 
            pushSubscription: JSON.stringify(subscription),
            notificationsEnabled: true,
            updatedAt: new Date()
          } 
        }
      );
      console.log('Update by _id result:', result2.matchedCount, 'matched,', result2.modifiedCount, 'modified');
      
      if (result2.matchedCount === 0) {
        // Last resort: create a separate pushSubscriptions collection
        console.log('Creating entry in pushSubscriptions collection...');
        await db.collection('pushSubscriptions').updateOne(
          { userId: userId },
          { 
            $set: { 
              userId: userId,
              subscription: JSON.stringify(subscription),
              enabled: true,
              updatedAt: new Date()
            } 
          },
          { upsert: true }
        );
        console.log('Push subscription saved to pushSubscriptions collection');
      }
    } catch (e) {
      // userId is not a valid ObjectId, use pushSubscriptions collection
      console.log('userId is not ObjectId format, using pushSubscriptions collection');
      await db.collection('pushSubscriptions').updateOne(
        { userId: userId },
        { 
          $set: { 
            userId: userId,
            subscription: JSON.stringify(subscription),
            enabled: true,
            updatedAt: new Date()
          } 
        },
        { upsert: true }
      );
      console.log('Push subscription saved to pushSubscriptions collection');
    }
  }
}

// Remove push subscription for a user
export async function removePushSubscription(userId: string): Promise<void> {
  const db = getDb();
  
  await db.collection('user').updateOne(
    { id: userId },
    { 
      $unset: { pushSubscription: '' },
      $set: { updatedAt: new Date() }
    }
  );
}
