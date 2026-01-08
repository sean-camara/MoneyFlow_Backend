import admin from 'firebase-admin';
import { getDb } from '../config/database.js';

// Initialize Firebase Admin
let firebaseInitialized = false;

export function initializeFirebase(): void {
  if (firebaseInitialized) return;

  // Check for service account credentials
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('✅ Firebase Admin initialized with service account');
    } catch (error) {
      console.error('Failed to parse Firebase service account:', error);
    }
  } else if (process.env.FIREBASE_PROJECT_ID) {
    // Initialize with project ID only (for environments with default credentials)
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized with project ID');
  } else {
    console.warn('⚠️ Firebase not configured. FCM push notifications will not work.');
    console.warn('Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID environment variable');
  }
}

// Send FCM notification to a single token
export async function sendFcmNotification(
  token: string,
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    icon?: string;
  }
): Promise<boolean> {
  if (!firebaseInitialized) {
    console.warn('Firebase not initialized, cannot send FCM notification');
    return false;
  }

  try {
    const message: admin.messaging.Message = {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.icon || '/icon-192.png',
        },
        fcmOptions: {
          link: '/',
        },
      },
      data: payload.data,
    };

    const response = await admin.messaging().send(message);
    console.log('FCM message sent:', response);
    return true;
  } catch (error: any) {
    console.error('Failed to send FCM notification:', error.message);
    
    // If token is invalid, it should be removed
    if (error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-registration-token') {
      console.log('FCM token invalid, should be removed');
    }
    
    return false;
  }
}

// Send FCM notification to multiple tokens
export async function sendFcmNotificationToMany(
  tokens: string[],
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    icon?: string;
  }
): Promise<{ successes: number; failures: number }> {
  if (!firebaseInitialized || tokens.length === 0) {
    return { successes: 0, failures: tokens.length };
  }

  try {
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.icon || '/icon-192.png',
        },
      },
      data: payload.data,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log('FCM multicast sent:', response.successCount, 'successes,', response.failureCount, 'failures');
    
    return {
      successes: response.successCount,
      failures: response.failureCount,
    };
  } catch (error: any) {
    console.error('Failed to send FCM multicast:', error.message);
    return { successes: 0, failures: tokens.length };
  }
}

// Get FCM tokens for users
export async function getFcmTokensForUsers(userIds: string[]): Promise<string[]> {
  const db = getDb();
  
  const users = await db.collection('user')
    .find({
      id: { $in: userIds },
      notificationsEnabled: true,
      pushSubscription: { $exists: true, $ne: null }
    })
    .toArray();
  
  const tokens: string[] = [];
  
  for (const user of users) {
    if (user.pushSubscription) {
      try {
        const sub = typeof user.pushSubscription === 'string'
          ? JSON.parse(user.pushSubscription)
          : user.pushSubscription;
        
        if (sub.fcmToken) {
          tokens.push(sub.fcmToken);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  
  return tokens;
}

export function isFirebaseInitialized(): boolean {
  return firebaseInitialized;
}
