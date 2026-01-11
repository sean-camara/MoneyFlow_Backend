const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');
const { generateInviteCode } = require('../utils/crypto');
const { sendJointAccountInviteEmail } = require('../services/emailService');
const admin = require('firebase-admin');

const router = express.Router();

// GET /api/joint-accounts - List user's joint accounts
router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    const jointAccounts = await db.collection('jointAccounts')
      .find({ 'members.userId': new ObjectId(userId) })
      .toArray();

    // Populate member details
    for (const account of jointAccounts) {
      const memberIds = account.members.map(m => m.userId);
      const users = await db.collection('users')
        .find({ _id: { $in: memberIds } })
        .project({ password: 0 })
        .toArray();

      account.members = account.members.map(member => {
        const user = users.find(u => u._id.toString() === member.userId.toString());
        return {
          ...member,
          user: user ? { _id: user._id, name: user.name, email: user.email, image: user.image } : null
        };
      });
    }

    res.json(jointAccounts);
  } catch (error) {
    console.error('Get joint accounts error:', error);
    res.status(500).json({ error: 'Failed to get joint accounts' });
  }
});

// POST /api/joint-accounts - Create joint account
router.post('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    const { name, description = '' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const inviteCode = generateInviteCode();

    const jointAccount = {
      name,
      description,
      ownerId: new ObjectId(userId),
      members: [{
        userId: new ObjectId(userId),
        role: 'owner',
        joinedAt: new Date()
      }],
      inviteCode,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('jointAccounts').insertOne(jointAccount);
    jointAccount._id = result.insertedId;

    // Add user details to response
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );

    jointAccount.members[0].user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image
    };

    res.status(201).json(jointAccount);
  } catch (error) {
    console.error('Create joint account error:', error);
    res.status(500).json({ error: 'Failed to create joint account' });
  }
});

// GET /api/joint-accounts/:id - Get joint account details
router.get('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;

    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found' });
    }

    // Populate member details
    const memberIds = jointAccount.members.map(m => m.userId);
    const users = await db.collection('users')
      .find({ _id: { $in: memberIds } })
      .project({ password: 0 })
      .toArray();

    jointAccount.members = jointAccount.members.map(member => {
      const user = users.find(u => u._id.toString() === member.userId.toString());
      return {
        ...member,
        user: user ? { _id: user._id, name: user.name, email: user.email, image: user.image } : null
      };
    });

    res.json(jointAccount);
  } catch (error) {
    console.error('Get joint account error:', error);
    res.status(500).json({ error: 'Failed to get joint account' });
  }
});

// PUT /api/joint-accounts/:id - Update joint account
router.put('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;

    // Check if user is owner or admin
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found' });
    }

    const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return res.status(403).json({ error: 'Only owners and admins can update joint accounts' });
    }

    const { name, description } = req.body;
    const updates = { updatedAt: new Date() };
    
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    await db.collection('jointAccounts').updateOne(
      { _id: new ObjectId(jointAccountId) },
      { $set: updates }
    );

    const updatedAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('joint-account-updated', updatedAccount);

    res.json(updatedAccount);
  } catch (error) {
    console.error('Update joint account error:', error);
    res.status(500).json({ error: 'Failed to update joint account' });
  }
});

// DELETE /api/joint-accounts/:id - Delete joint account
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;

    // Only owner can delete
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      ownerId: new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Only the owner can delete a joint account' });
    }

    // Delete joint account
    await db.collection('jointAccounts').deleteOne({ _id: new ObjectId(jointAccountId) });

    // Delete related transactions
    await db.collection('transactions').deleteMany({ jointAccountId: new ObjectId(jointAccountId) });

    // Delete related goals
    await db.collection('goals').deleteMany({ jointAccountId: new ObjectId(jointAccountId) });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('joint-account-deleted', { _id: jointAccountId });

    res.json({ message: 'Joint account deleted successfully' });
  } catch (error) {
    console.error('Delete joint account error:', error);
    res.status(500).json({ error: 'Failed to delete joint account' });
  }
});

// POST /api/joint-accounts/:id/invite - Generate new invite code
router.post('/:id/invite', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;

    // Check if user is owner or admin
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found' });
    }

    const member = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return res.status(403).json({ error: 'Only owners and admins can generate invite codes' });
    }

    const inviteCode = generateInviteCode();

    await db.collection('jointAccounts').updateOne(
      { _id: new ObjectId(jointAccountId) },
      { $set: { inviteCode, updatedAt: new Date() } }
    );

    res.json({ inviteCode });
  } catch (error) {
    console.error('Generate invite code error:', error);
    res.status(500).json({ error: 'Failed to generate invite code' });
  }
});

// POST /api/joint-accounts/:id/invite-email - Invite by email
router.post('/:id/invite-email', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user is owner or admin
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found' });
    }

    const inviter = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    if (!inviter || !['owner', 'admin'].includes(inviter.role)) {
      return res.status(403).json({ error: 'Only owners and admins can invite members' });
    }

    // Find user by email
    const invitedUser = await db.collection('users').findOne({ email: email.toLowerCase() });

    if (!invitedUser) {
      return res.status(404).json({ error: 'No user found with this email address' });
    }

    // Check if user is already a member
    const isMember = jointAccount.members.some(
      m => m.userId.toString() === invitedUser._id.toString()
    );

    if (isMember) {
      return res.status(400).json({ error: 'This user is already a member of this account' });
    }

    // Check if there's already a pending invite
    const existingInvite = await db.collection('notifications').findOne({
      userId: invitedUser._id,
      type: 'joint_account_invite',
      'data.jointAccountId': jointAccountId,
      actionTaken: { $exists: false }
    });

    if (existingInvite) {
      return res.status(400).json({ error: 'An invite has already been sent to this user' });
    }

    // Get inviter's info
    const inviterUser = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { name: 1, email: 1 } }
    );

    // Create notification for the invited user
    const notification = {
      userId: invitedUser._id,
      type: 'joint_account_invite',
      title: 'Joint Account Invite',
      message: `${inviterUser.name} has invited you to join "${jointAccount.name}"`,
      data: {
        jointAccountId,
        jointAccountName: jointAccount.name,
        invitedBy: userId,
        inviterName: inviterUser.name,
        inviterEmail: inviterUser.email
      },
      read: false,
      createdAt: new Date()
    };

    await db.collection('notifications').insertOne(notification);

    // Send push notification
    const subscriptions = await db.collection('pushSubscriptions')
      .find({ userId: invitedUser._id })
      .toArray();

    if (subscriptions.length > 0) {
      const tokens = subscriptions.map(s => s.fcmToken);
      try {
        await admin.messaging().sendEachForMulticast({
          notification: {
            title: 'Joint Account Invite',
            body: `${inviterUser.name} has invited you to join "${jointAccount.name}"`
          },
          tokens
        });
      } catch (pushError) {
        console.error('Push notification error:', pushError);
      }
    }

    // Send email notification
    try {
      await sendJointAccountInviteEmail(
        invitedUser.email,
        invitedUser.name || 'User',
        inviterUser.name,
        jointAccount.name
      );
    } catch (emailError) {
      console.error('Email notification error:', emailError);
      // Don't fail the request if email fails
    }

    res.json({ message: `Invite sent to ${email}` });
  } catch (error) {
    console.error('Email invite error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// POST /api/joint-accounts/join - Join via invite code
router.post('/join', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { inviteCode } = req.body;

    if (!inviteCode) {
      return res.status(400).json({ error: 'Invite code is required' });
    }

    const jointAccount = await db.collection('jointAccounts').findOne({
      inviteCode: inviteCode.toUpperCase()
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    // Check if already a member
    const existingMember = jointAccount.members.find(
      m => m.userId.toString() === userId.toString()
    );

    if (existingMember) {
      return res.status(400).json({ error: 'Already a member of this joint account' });
    }

    // Add as member
    await db.collection('jointAccounts').updateOne(
      { _id: jointAccount._id },
      {
        $push: {
          members: {
            userId: new ObjectId(userId),
            role: 'editor', // Default to editor (can add/edit transactions)
            joinedAt: new Date()
          }
        },
        $set: { updatedAt: new Date() }
      }
    );

    const updatedAccount = await db.collection('jointAccounts').findOne({
      _id: jointAccount._id
    });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`joint:${jointAccount._id}`).emit('member-joined', {
      jointAccountId: jointAccount._id,
      userId
    });

    res.json(updatedAccount);
  } catch (error) {
    console.error('Join joint account error:', error);
    res.status(500).json({ error: 'Failed to join joint account' });
  }
});

// PUT /api/joint-accounts/:id/members/:userId - Update member role
router.put('/:id/members/:memberId', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;
    const memberId = req.params.memberId;
    const { role } = req.body;

    // Valid roles: admin (can manage), editor (can add/edit transactions), viewer (read-only)
    if (!role || !['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Valid role is required (admin, editor, or viewer)' });
    }

    // Check if user is owner or admin
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found' });
    }

    const currentMember = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    if (!currentMember || !['owner', 'admin'].includes(currentMember.role)) {
      return res.status(403).json({ error: 'Only owners and admins can change member roles' });
    }

    // Can't change owner's role
    const targetMember = jointAccount.members.find(m => m.userId.toString() === memberId);
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: "Cannot change owner's role" });
    }

    // Admin can't change another admin's role (only owner can)
    if (targetMember.role === 'admin' && currentMember.role !== 'owner') {
      return res.status(403).json({ error: "Only the owner can change an admin's role" });
    }

    await db.collection('jointAccounts').updateOne(
      { 
        _id: new ObjectId(jointAccountId),
        'members.userId': new ObjectId(memberId)
      },
      {
        $set: {
          'members.$.role': role,
          updatedAt: new Date()
        }
      }
    );

    // Get updated account with populated members
    const updatedAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    // Populate member details
    const memberIds = updatedAccount.members.map(m => m.userId);
    const users = await db.collection('users')
      .find({ _id: { $in: memberIds } })
      .project({ password: 0 })
      .toArray();

    updatedAccount.members = updatedAccount.members.map(member => {
      const user = users.find(u => u._id.toString() === member.userId.toString());
      return {
        ...member,
        user: user ? { _id: user._id, name: user.name, email: user.email, image: user.image } : null
      };
    });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('member-role-updated', {
      jointAccountId,
      memberId,
      role
    });

    res.json(updatedAccount);
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// DELETE /api/joint-accounts/:id/members/:userId - Remove member
router.delete('/:id/members/:memberId', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;
    const memberId = req.params.memberId;

    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found' });
    }

    // Check permissions
    const currentMember = jointAccount.members.find(m => m.userId.toString() === userId.toString());
    const targetMember = jointAccount.members.find(m => m.userId.toString() === memberId);

    if (!currentMember) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Users can remove themselves, or owner/admin can remove others
    const isSelf = userId.toString() === memberId;
    const isOwnerOrAdmin = ['owner', 'admin'].includes(currentMember.role);

    if (!isSelf && !isOwnerOrAdmin) {
      return res.status(403).json({ error: 'Not authorized to remove this member' });
    }

    // Owner can't be removed (must delete account instead)
    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot be removed. Delete the joint account instead.' });
    }

    await db.collection('jointAccounts').updateOne(
      { _id: new ObjectId(jointAccountId) },
      {
        $pull: { members: { userId: new ObjectId(memberId) } },
        $set: { updatedAt: new Date() }
      }
    );

    // Emit socket event
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('member-removed', {
      jointAccountId,
      memberId
    });

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// POST /api/joint-accounts/:id/leave - Leave a joint account
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;

    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(404).json({ error: 'Joint account not found or not a member' });
    }

    // Owner can't leave - must delete or transfer ownership
    if (jointAccount.ownerId.toString() === userId.toString()) {
      return res.status(400).json({ error: 'Owner cannot leave. Delete the account or transfer ownership first.' });
    }

    await db.collection('jointAccounts').updateOne(
      { _id: new ObjectId(jointAccountId) },
      {
        $pull: { members: { userId: new ObjectId(userId) } },
        $set: { updatedAt: new Date() }
      }
    );

    // Emit socket event
    const io = req.app.get('io');
    io.to(`joint:${jointAccountId}`).emit('member-left', {
      jointAccountId,
      userId
    });

    res.json({ message: 'Left joint account successfully' });
  } catch (error) {
    console.error('Leave joint account error:', error);
    res.status(500).json({ error: 'Failed to leave joint account' });
  }
});

// GET /api/joint-accounts/:id/transactions - Get joint account transactions
router.get('/:id/transactions', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const jointAccountId = req.params.id;

    // Check membership
    const jointAccount = await db.collection('jointAccounts').findOne({
      _id: new ObjectId(jointAccountId),
      'members.userId': new ObjectId(userId)
    });

    if (!jointAccount) {
      return res.status(403).json({ error: 'Not a member of this joint account' });
    }

    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await db.collection('transactions')
      .find({ jointAccountId: new ObjectId(jointAccountId) })
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await db.collection('transactions').countDocuments({
      jointAccountId: new ObjectId(jointAccountId)
    });

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get joint account transactions error:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

module.exports = router;
