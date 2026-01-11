const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/crypto');

const router = express.Router();

// GET /api/user/me - Get profile (alias for /api/auth/me)
router.get('/me', auth, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /api/user/me - Update profile (name, image)
router.put('/me', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { name, image } = req.body;

    const updates = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (image !== undefined) updates.image = image; // base64 or URL

    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: updates }
    );

    const updatedUser = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );

    res.json({ user: updatedUser });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/user/password - Change password
router.put('/password', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Get user with password
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });

    // If user has a password, verify current password
    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }

      const isValid = await verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /api/user/settings - Get user settings
router.get('/settings', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    let settings = await db.collection('settings').findOne({
      userId: new ObjectId(userId)
    });

    // If no settings exist, create default
    if (!settings) {
      settings = {
        userId: new ObjectId(userId),
        primaryCurrency: 'PHP',
        theme: 'dark',
        notificationsEnabled: true,
        tutorialCompleted: false,
        createdAt: new Date()
      };
      await db.collection('settings').insertOne(settings);
    }

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /api/user/settings - Update settings
router.put('/settings', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { primaryCurrency, theme, notificationsEnabled, tutorialCompleted } = req.body;

    const updates = { updatedAt: new Date() };
    if (primaryCurrency !== undefined) updates.primaryCurrency = primaryCurrency;
    if (theme !== undefined) updates.theme = theme;
    if (notificationsEnabled !== undefined) updates.notificationsEnabled = notificationsEnabled;
    if (tutorialCompleted !== undefined) updates.tutorialCompleted = tutorialCompleted;

    await db.collection('settings').updateOne(
      { userId: new ObjectId(userId) },
      { $set: updates },
      { upsert: true }
    );

    const settings = await db.collection('settings').findOne({
      userId: new ObjectId(userId)
    });

    res.json(settings);
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// DELETE /api/user/me - Delete account
router.delete('/me', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    // Delete user's sessions
    await db.collection('sessions').deleteMany({ userId: new ObjectId(userId) });

    // Delete user's transactions (personal only)
    await db.collection('transactions').deleteMany({
      userId: new ObjectId(userId),
      jointAccountId: { $exists: false }
    });

    // Delete user's goals (personal only)
    await db.collection('goals').deleteMany({
      userId: new ObjectId(userId),
      jointAccountId: { $exists: false }
    });

    // Delete user's categories
    await db.collection('categories').deleteMany({ userId: new ObjectId(userId) });

    // Delete user's settings
    await db.collection('settings').deleteMany({ userId: new ObjectId(userId) });

    // Delete user's push subscriptions
    await db.collection('pushSubscriptions').deleteMany({ userId: new ObjectId(userId) });

    // Remove user from joint accounts (don't delete the accounts)
    await db.collection('jointAccounts').updateMany(
      { 'members.userId': new ObjectId(userId) },
      { $pull: { members: { userId: new ObjectId(userId) } } }
    );

    // Delete joint accounts where user is owner
    const ownedAccounts = await db.collection('jointAccounts')
      .find({ ownerId: new ObjectId(userId) })
      .toArray();

    for (const account of ownedAccounts) {
      await db.collection('transactions').deleteMany({ jointAccountId: account._id });
      await db.collection('goals').deleteMany({ jointAccountId: account._id });
      await db.collection('jointAccounts').deleteOne({ _id: account._id });
    }

    // Delete user
    await db.collection('users').deleteOne({ _id: new ObjectId(userId) });

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
