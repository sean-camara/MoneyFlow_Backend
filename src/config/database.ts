import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) {
    return { client, db };
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/flowmoney';
  
  client = new MongoClient(uri);
  await client.connect();
  
  db = client.db();
  
  console.log('✅ Connected to MongoDB');
  
  // Create indexes for better query performance
  await createIndexes(db);
  
  return { client, db };
}

async function createIndexes(db: Db): Promise<void> {
  // Users collection - Better Auth manages this but we add custom indexes
  await db.collection('user').createIndex({ email: 1 }, { unique: true });
  
  // Joint accounts
  await db.collection('jointAccounts').createIndex({ adminUserId: 1 });
  
  // Joint account members
  await db.collection('jointAccountMembers').createIndex({ jointAccountId: 1 });
  await db.collection('jointAccountMembers').createIndex({ userId: 1 });
  await db.collection('jointAccountMembers').createIndex(
    { jointAccountId: 1, userId: 1 }, 
    { unique: true }
  );
  
  // Joint account invites
  await db.collection('jointAccountInvites').createIndex({ jointAccountId: 1 });
  await db.collection('jointAccountInvites').createIndex({ invitedEmail: 1 });
  await db.collection('jointAccountInvites').createIndex({ status: 1 });
  
  // Transactions
  await db.collection('transactions').createIndex({ jointAccountId: 1 });
  await db.collection('transactions').createIndex({ addedByUserId: 1 });
  await db.collection('transactions').createIndex({ date: -1 });
  await db.collection('transactions').createIndex({ jointAccountId: 1, date: -1 });
  
  // Goals
  await db.collection('goals').createIndex({ jointAccountId: 1 });
  
  // Subscriptions
  await db.collection('subscriptions').createIndex({ jointAccountId: 1 });
  
  // Custom categories
  await db.collection('customCategories').createIndex({ jointAccountId: 1 });
  
  console.log('✅ Database indexes created');
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectToDatabase first.');
  }
  return db;
}

export function getClient(): MongoClient {
  if (!client) {
    throw new Error('Database not connected. Call connectToDatabase first.');
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('📤 Disconnected from MongoDB');
  }
}
