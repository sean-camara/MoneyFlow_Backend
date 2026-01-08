import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { requireJointAccountAdmin, requireJointAccountMember } from '../middleware/jointAccount.js';
import { emitToUser, emitToJointAccount, SocketEvents } from '../services/socketService.js';
import { 
  JointAccount, 
  JointAccountMember, 
  JointAccountInvite,
  JointAccountRole, 
  InviteStatus,
  Currency 
} from '../types/index.js';
import { Auth } from '../config/auth.js';

export function createJointAccountRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Get all joint accounts for the current user
  router.get('/', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;

      // Get all memberships for this user
      const userMemberships = await db.collection<JointAccountMember>('jointAccountMembers')
        .find({ userId })
        .toArray();

      const accountIds = userMemberships.map(m => m.jointAccountId);

      // Get the actual accounts
      const accounts = await db.collection<JointAccount>('jointAccounts')
        .find({ id: { $in: accountIds } })
        .toArray();

      // Get ALL members for all accounts (not just current user)
      const allMemberships = await db.collection<JointAccountMember>('jointAccountMembers')
        .find({ jointAccountId: { $in: accountIds } })
        .toArray();

      // Get all user IDs we need to look up (admins + members)
      const adminUserIds = accounts.map(a => a.adminUserId);
      const memberUserIds = allMemberships.map(m => m.userId);
      const allUserIds = [...new Set([...adminUserIds, ...memberUserIds])];
      
      // Try to find users by 'id' field first
      let allUsers = await db.collection('user')
        .find({ id: { $in: allUserIds } })
        .toArray();
      
      // If not all found, try with MongoDB _id field
      if (allUsers.length < allUserIds.length) {
        try {
          const { ObjectId } = await import('mongodb');
          const foundIds = allUsers.map(u => u.id);
          const missingIds = allUserIds.filter(id => !foundIds.includes(id));
          const objectIds = missingIds
            .filter(id => ObjectId.isValid(id))
            .map(id => new ObjectId(id));
          
          if (objectIds.length > 0) {
            const additionalUsers = await db.collection('user')
              .find({ _id: { $in: objectIds } })
              .toArray();
            // Normalize and add
            allUsers = [...allUsers, ...additionalUsers.map(u => ({ ...u, id: u._id.toString() }))];
          }
        } catch (e) {
          console.error('🔍 ObjectId lookup failed:', e);
        }
      }
      
      // Debug logging
      console.log('🔍 Looking for users with ids:', allUserIds.length);
      console.log('🔍 Found users:', allUsers.length);

      // Combine with membership info and admin details
      const result = accounts.map(account => {
        const userMembership = userMemberships.find(m => m.jointAccountId === account.id);
        
        // Get admin user
        const adminUser = allUsers.find(u => 
          u.id === account.adminUserId || 
          u._id?.toString() === account.adminUserId
        );
        
        // Get all members for this account with user details
        const accountMembers = allMemberships
          .filter(m => m.jointAccountId === account.id)
          .map(m => {
            const user = allUsers.find(u => u.id === m.userId || u._id?.toString() === m.userId);
            return {
              ...m,
              userName: user?.name || 'Unknown',
              userEmail: user?.email || '',
              userImage: user?.image || null,
            };
          });
        
        return {
          ...account,
          role: userMembership?.role,
          joinedAt: userMembership?.joinedAt,
          adminName: adminUser?.name || 'Unknown',
          adminEmail: adminUser?.email || '',
          adminImage: adminUser?.image || null,
          members: accountMembers,
        };
      });

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error fetching joint accounts:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch joint accounts' });
    }
  });

  // Create a new joint account
  router.post('/', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const { name, primaryCurrency = Currency.USD } = req.body;

      console.log('📝 Creating joint account:', { name, userId, primaryCurrency });

      if (!name) {
        return res.status(400).json({ success: false, error: 'Account name is required' });
      }

      const accountId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      const now = new Date();

      // Create the joint account
      const jointAccount: JointAccount = {
        id: accountId,
        name,
        primaryCurrency,
        adminUserId: userId,
        createdAt: now,
        updatedAt: now
      };

      // Create admin membership
      const membership: JointAccountMember = {
        id: membershipId,
        jointAccountId: accountId,
        userId,
        role: JointAccountRole.ADMIN,
        joinedAt: now
      };

      await db.collection<JointAccount>('jointAccounts').insertOne(jointAccount);
      await db.collection<JointAccountMember>('jointAccountMembers').insertOne(membership);

      console.log('✅ Joint account created:', accountId);

      res.status(201).json({ 
        success: true, 
        data: { ...jointAccount, role: JointAccountRole.ADMIN } 
      });
    } catch (error) {
      console.error('❌ Error creating joint account:', error);
      res.status(500).json({ success: false, error: 'Failed to create joint account' });
    }
  });

  // Get a specific joint account
  router.get('/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;

      const account = await db.collection<JointAccount>('jointAccounts')
        .findOne({ id: jointAccountId });

      if (!account) {
        return res.status(404).json({ success: false, error: 'Joint account not found' });
      }

      // Get all members
      const members = await db.collection<JointAccountMember>('jointAccountMembers')
        .find({ jointAccountId })
        .toArray();

      // Get user details for members
      const memberUserIds = members.map(m => m.userId);
      const users = await db.collection('user')
        .find({ id: { $in: memberUserIds } })
        .toArray();

      const membersWithDetails = members.map(m => {
        const user = users.find(u => u.id === m.userId);
        return {
          ...m,
          userName: user?.name || 'Unknown',
          userEmail: user?.email || ''
        };
      });

      res.json({ 
        success: true, 
        data: { 
          ...account, 
          members: membersWithDetails,
          role: (req as any).jointAccountMembership?.role
        } 
      });
    } catch (error) {
      console.error('Error fetching joint account:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch joint account' });
    }
  });

  // Update joint account (admin only)
  router.put('/:jointAccountId', authMiddleware, requireJointAccountAdmin, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;
      const { name, primaryCurrency } = req.body;

      const updateData: Partial<JointAccount> = { updatedAt: new Date() };
      if (name) updateData.name = name;
      if (primaryCurrency) updateData.primaryCurrency = primaryCurrency;

      await db.collection<JointAccount>('jointAccounts').updateOne(
        { id: jointAccountId },
        { $set: updateData }
      );

      const updated = await db.collection<JointAccount>('jointAccounts')
        .findOne({ id: jointAccountId });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating joint account:', error);
      res.status(500).json({ success: false, error: 'Failed to update joint account' });
    }
  });

  // Invite a user to joint account (admin only)
  router.post('/:jointAccountId/invite', authMiddleware, requireJointAccountAdmin, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;
      const { email } = req.body;
      const inviterId = req.user!.id;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // Check if user is already a member
      const existingUser = await db.collection('user').findOne({ email });
      if (existingUser) {
        const existingMembership = await db.collection<JointAccountMember>('jointAccountMembers')
          .findOne({ jointAccountId, userId: existingUser.id });
        
        if (existingMembership) {
          return res.status(400).json({ success: false, error: 'User is already a member' });
        }
      }

      // Check for existing pending invite
      const existingInvite = await db.collection<JointAccountInvite>('jointAccountInvites')
        .findOne({ 
          jointAccountId, 
          invitedEmail: email.toLowerCase(),
          status: InviteStatus.PENDING 
        });

      if (existingInvite) {
        return res.status(400).json({ success: false, error: 'Invitation already pending' });
      }

      // Get account details and inviter info
      const account = await db.collection<JointAccount>('jointAccounts').findOne({ id: jointAccountId });
      const inviter = await db.collection('user').findOne({ id: inviterId });

      // Create invite
      const invite: JointAccountInvite = {
        id: crypto.randomUUID(),
        jointAccountId,
        invitedEmail: email.toLowerCase(),
        invitedByUserId: inviterId,
        status: InviteStatus.PENDING,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      };

      await db.collection<JointAccountInvite>('jointAccountInvites').insertOne(invite);

      // Emit socket event to invited user if they exist
      const invitedUser = await db.collection('user').findOne({ email: email.toLowerCase() });
      if (invitedUser) {
        emitToUser(invitedUser.id, SocketEvents.INVITE_RECEIVED, {
          ...invite,
          accountName: account?.name || 'Unknown Account',
          inviterName: inviter?.name || 'Someone',
          inviterEmail: inviter?.email || '',
        });
      }

      res.status(201).json({ success: true, data: invite });
    } catch (error) {
      console.error('Error creating invite:', error);
      res.status(500).json({ success: false, error: 'Failed to create invitation' });
    }
  });

  // Get pending invites for current user
  router.get('/invites/pending', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const userEmail = req.user!.email.toLowerCase();

      const invites = await db.collection<JointAccountInvite>('jointAccountInvites')
        .find({ 
          invitedEmail: userEmail,
          status: InviteStatus.PENDING,
          expiresAt: { $gt: new Date() }
        })
        .toArray();

      // Get account details
      const accountIds = invites.map(i => i.jointAccountId);
      const accounts = await db.collection<JointAccount>('jointAccounts')
        .find({ id: { $in: accountIds } })
        .toArray();

      // Get inviter details
      const inviterIds = invites.map(i => i.invitedByUserId);
      const inviters = await db.collection('user')
        .find({ id: { $in: inviterIds } })
        .toArray();

      const invitesWithDetails = invites.map(invite => {
        const account = accounts.find(a => a.id === invite.jointAccountId);
        const inviter = inviters.find(u => u.id === invite.invitedByUserId);
        return {
          ...invite,
          accountName: account?.name || 'Unknown Account',
          inviterName: inviter?.name || 'Someone',
          inviterEmail: inviter?.email || '',
        };
      });

      res.json({ success: true, data: invitesWithDetails });
    } catch (error) {
      console.error('Error fetching invites:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch invitations' });
    }
  });

  // Accept or decline an invite
  router.post('/invites/:inviteId/respond', authMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { inviteId } = req.params;
      const { accept } = req.body;
      const userId = req.user!.id;
      const userEmail = req.user!.email.toLowerCase();

      const invite = await db.collection<JointAccountInvite>('jointAccountInvites')
        .findOne({ id: inviteId });

      if (!invite) {
        return res.status(404).json({ success: false, error: 'Invitation not found' });
      }

      if (invite.invitedEmail !== userEmail) {
        return res.status(403).json({ success: false, error: 'This invitation is not for you' });
      }

      if (invite.status !== InviteStatus.PENDING) {
        return res.status(400).json({ success: false, error: 'Invitation already responded to' });
      }

      if (new Date() > invite.expiresAt) {
        return res.status(400).json({ success: false, error: 'Invitation has expired' });
      }

      const newStatus = accept ? InviteStatus.ACCEPTED : InviteStatus.DECLINED;

      await db.collection<JointAccountInvite>('jointAccountInvites').updateOne(
        { id: inviteId },
        { $set: { status: newStatus } }
      );

      // Get account and user info for socket events
      const account = await db.collection<JointAccount>('jointAccounts').findOne({ id: invite.jointAccountId });
      const user = await db.collection('user').findOne({ id: userId });

      if (accept) {
        // Create membership
        const membership: JointAccountMember = {
          id: crypto.randomUUID(),
          jointAccountId: invite.jointAccountId,
          userId,
          role: JointAccountRole.MEMBER,
          joinedAt: new Date()
        };

        await db.collection<JointAccountMember>('jointAccountMembers').insertOne(membership);

        // Emit to admin that a new member joined
        if (account) {
          emitToUser(account.adminUserId, SocketEvents.MEMBER_JOINED, {
            jointAccountId: invite.jointAccountId,
            accountName: account.name,
            member: {
              ...membership,
              userName: user?.name || 'Unknown',
              userEmail: user?.email || ''
            }
          });

          // Also emit to the joint account room
          emitToJointAccount(invite.jointAccountId, SocketEvents.MEMBER_JOINED, {
            jointAccountId: invite.jointAccountId,
            member: {
              ...membership,
              userName: user?.name || 'Unknown',
              userEmail: user?.email || ''
            }
          });
        }
      } else {
        // Emit to admin that invite was declined
        if (account) {
          emitToUser(account.adminUserId, SocketEvents.INVITE_DECLINED, {
            inviteId,
            jointAccountId: invite.jointAccountId,
            invitedEmail: invite.invitedEmail
          });
        }
      }

      res.json({ 
        success: true, 
        message: accept ? 'Successfully joined the account' : 'Invitation declined' 
      });
    } catch (error) {
      console.error('Error responding to invite:', error);
      res.status(500).json({ success: false, error: 'Failed to respond to invitation' });
    }
  });

  // Remove a member (admin only)
  router.delete('/:jointAccountId/members/:memberId', authMiddleware, requireJointAccountAdmin, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId, memberId } = req.params;
      const adminId = req.user!.id;

      // Can't remove yourself if you're the admin
      const memberToRemove = await db.collection<JointAccountMember>('jointAccountMembers')
        .findOne({ id: memberId, jointAccountId });

      if (!memberToRemove) {
        return res.status(404).json({ success: false, error: 'Member not found' });
      }

      if (memberToRemove.userId === adminId) {
        return res.status(400).json({ success: false, error: 'Admin cannot remove themselves' });
      }

      await db.collection<JointAccountMember>('jointAccountMembers').deleteOne({ id: memberId });

      res.json({ success: true, message: 'Member removed successfully' });
    } catch (error) {
      console.error('Error removing member:', error);
      res.status(500).json({ success: false, error: 'Failed to remove member' });
    }
  });

  // Delete a joint account (admin only)
  router.delete('/:jointAccountId', authMiddleware, requireJointAccountAdmin, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;

      // Delete all members
      await db.collection<JointAccountMember>('jointAccountMembers').deleteMany({ jointAccountId });

      // Delete all invites
      await db.collection<JointAccountInvite>('jointAccountInvites').deleteMany({ jointAccountId });

      // Delete the account itself
      await db.collection<JointAccount>('jointAccounts').deleteOne({ id: jointAccountId });

      console.log('✅ Joint account deleted:', jointAccountId);

      res.json({ success: true, message: 'Joint account deleted successfully' });
    } catch (error) {
      console.error('Error deleting joint account:', error);
      res.status(500).json({ success: false, error: 'Failed to delete joint account' });
    }
  });

  // Get invites for a joint account (admin only) - only pending invites
  router.get('/:jointAccountId/invites', authMiddleware, requireJointAccountAdmin, async (req, res) => {
    try {
      const db = getDb();
      const { jointAccountId } = req.params;

      // Only return pending invites, not accepted/declined ones
      const invites = await db.collection<JointAccountInvite>('jointAccountInvites')
        .find({ jointAccountId, status: InviteStatus.PENDING })
        .sort({ createdAt: -1 })
        .toArray();

      res.json({ success: true, data: invites });
    } catch (error) {
      console.error('Error fetching invites:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch invitations' });
    }
  });

  // Cancel an invite (admin only)
  router.delete('/:jointAccountId/invites/:inviteId', authMiddleware, requireJointAccountAdmin, async (req, res) => {
    try {
      const db = getDb();
      const { inviteId, jointAccountId } = req.params;

      const result = await db.collection<JointAccountInvite>('jointAccountInvites')
        .deleteOne({ id: inviteId, jointAccountId });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Invitation not found' });
      }

      res.json({ success: true, message: 'Invitation cancelled' });
    } catch (error) {
      console.error('Error cancelling invite:', error);
      res.status(500).json({ success: false, error: 'Failed to cancel invitation' });
    }
  });

  return router;
}
