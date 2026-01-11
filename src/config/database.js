const { MongoClient } = require('mongodb');

let db = null;
let client = null;

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    client = new MongoClient(uri);
    await client.connect();
    db = client.db('flowmoney');
    
    console.log('✅ Connected to MongoDB');
    
    // Create indexes for better performance
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
};

const createIndexes = async () => {
  try {
    // Users collection indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ googleId: 1 }, { sparse: true });

    // Sessions collection indexes
    await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ userId: 1 });
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // Transactions collection indexes
    await db.collection('transactions').createIndex({ userId: 1, date: -1 });
    await db.collection('transactions').createIndex({ jointAccountId: 1, date: -1 });

    // Goals collection indexes
    await db.collection('goals').createIndex({ userId: 1 });
    await db.collection('goals').createIndex({ jointAccountId: 1 });

    // Joint accounts collection indexes
    await db.collection('jointAccounts').createIndex({ ownerId: 1 });
    await db.collection('jointAccounts').createIndex({ 'members.userId': 1 });
    await db.collection('jointAccounts').createIndex({ inviteCode: 1 }, { unique: true, sparse: true });

    // Categories collection indexes
    await db.collection('categories').createIndex({ userId: 1 });

    // Push subscriptions collection indexes
    await db.collection('pushSubscriptions').createIndex({ userId: 1 });
    await db.collection('pushSubscriptions').createIndex({ fcmToken: 1 }, { unique: true });

    // Settings collection indexes
    await db.collection('settings').createIndex({ userId: 1 }, { unique: true });

    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
};

const getDB = () => {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
};

const closeDB = async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
};

module.exports = { connectDB, getDB, closeDB };
