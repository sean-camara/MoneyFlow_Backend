import { ObjectId, Db } from 'mongodb';
import { getDb } from '../config/database.js';

/**
 * Helper to find user by ID - handles both 'id' field and MongoDB '_id'
 * This is needed because better-auth uses 'id' but existing users have '_id'
 */
export async function findUserById(userId: string, db?: Db) {
  const database = db || getDb();
  // First try by 'id' field (for users created with better-auth's sign-up)
  let user = await database.collection('user').findOne({ id: userId });
  if (!user) {
    // Try by MongoDB _id (for existing users)
    try {
      user = await database.collection('user').findOne({ _id: new ObjectId(userId) });
    } catch (e) {
      // Invalid ObjectId format, continue
    }
  }
  return user;
}

/**
 * Helper to update user by ID - handles both 'id' field and MongoDB '_id'
 */
export async function updateUserById(userId: string, updateData: Record<string, any>, db?: Db) {
  const database = db || getDb();
  // Try by 'id' field first
  let result = await database.collection('user').updateOne({ id: userId }, { $set: updateData });
  if (result.matchedCount === 0) {
    // Try by MongoDB _id
    try {
      result = await database.collection('user').updateOne({ _id: new ObjectId(userId) }, { $set: updateData });
    } catch (e) {
      // Invalid ObjectId format
    }
  }
  return result;
}

/**
 * Get the consistent user ID as a string
 */
export function getUserIdString(user: any): string {
  return user._id?.toString() || user.id;
}
