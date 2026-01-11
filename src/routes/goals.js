const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/goals - List user's goals
router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const { jointAccountId } = req.query;

    const query = {};
    
    if (jointAccountId) {
      query.jointAccountId = new ObjectId(jointAccountId);
    } else {
      query.userId = new ObjectId(userId);
      query.jointAccountId = { $exists: false };
    }

    const goals = await db.collection('goals')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.json(goals);
  } catch (error) {
    console.error('Get goals error:', error);
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

// POST /api/goals - Create goal
router.post('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    const {
      name,
      targetAmount,
      currentAmount = 0,
      currency = 'PHP',
      deadline,
      jointAccountId
    } = req.body;

    if (!name || !targetAmount) {
      return res.status(400).json({ error: 'Name and target amount are required' });
    }

    // If joint account, verify membership
    if (jointAccountId) {
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: new ObjectId(jointAccountId),
        'members.userId': new ObjectId(userId)
      });

      if (!jointAccount) {
        return res.status(403).json({ error: 'Not a member of this joint account' });
      }
    }

    const goal = {
      userId: new ObjectId(userId),
      name,
      targetAmount: parseFloat(targetAmount),
      currentAmount: parseFloat(currentAmount),
      currency,
      deadline: deadline ? new Date(deadline) : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (jointAccountId) {
      goal.jointAccountId = new ObjectId(jointAccountId);
    }

    const result = await db.collection('goals').insertOne(goal);
    goal._id = result.insertedId;

    // Emit socket event
    const io = req.app.get('io');
    if (jointAccountId) {
      io.to(`joint:${jointAccountId}`).emit('goal-created', goal);
    }

    res.status(201).json(goal);
  } catch (error) {
    console.error('Create goal error:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// PUT /api/goals/:id - Update goal
router.put('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const goalId = req.params.id;

    // Find goal
    const goal = await db.collection('goals').findOne({
      _id: new ObjectId(goalId)
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check ownership
    const isOwner = goal.userId.toString() === userId.toString();
    let isJointMember = false;

    if (goal.jointAccountId) {
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: goal.jointAccountId,
        'members.userId': new ObjectId(userId)
      });
      isJointMember = !!jointAccount;
    }

    if (!isOwner && !isJointMember) {
      return res.status(403).json({ error: 'Not authorized to update this goal' });
    }

    const { name, targetAmount, currentAmount, currency, deadline } = req.body;

    const updates = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (targetAmount !== undefined) updates.targetAmount = parseFloat(targetAmount);
    if (currentAmount !== undefined) updates.currentAmount = parseFloat(currentAmount);
    if (currency !== undefined) updates.currency = currency;
    if (deadline !== undefined) updates.deadline = deadline ? new Date(deadline) : null;

    await db.collection('goals').updateOne(
      { _id: new ObjectId(goalId) },
      { $set: updates }
    );

    const updatedGoal = await db.collection('goals').findOne({
      _id: new ObjectId(goalId)
    });

    // Emit socket event
    const io = req.app.get('io');
    if (goal.jointAccountId) {
      io.to(`joint:${goal.jointAccountId}`).emit('goal-updated', updatedGoal);
    }

    res.json(updatedGoal);
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /api/goals/:id - Delete goal
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const goalId = req.params.id;

    // Find goal
    const goal = await db.collection('goals').findOne({
      _id: new ObjectId(goalId)
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check ownership
    const isOwner = goal.userId.toString() === userId.toString();
    let isJointMember = false;

    if (goal.jointAccountId) {
      const jointAccount = await db.collection('jointAccounts').findOne({
        _id: goal.jointAccountId,
        'members.userId': new ObjectId(userId)
      });
      isJointMember = !!jointAccount;
    }

    if (!isOwner && !isJointMember) {
      return res.status(403).json({ error: 'Not authorized to delete this goal' });
    }

    await db.collection('goals').deleteOne({ _id: new ObjectId(goalId) });

    // Emit socket event
    const io = req.app.get('io');
    if (goal.jointAccountId) {
      io.to(`joint:${goal.jointAccountId}`).emit('goal-deleted', { _id: goalId });
    }

    res.json({ message: 'Goal deleted successfully' });
  } catch (error) {
    console.error('Delete goal error:', error);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// POST /api/goals/:id/contribute - Add to goal
router.post('/:id/contribute', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const goalId = req.params.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Find goal
    const goal = await db.collection('goals').findOne({
      _id: new ObjectId(goalId)
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Check ownership
    const isOwner = goal.userId.toString() === userId.toString();
    let isJointMember = false;
    let jointAccount = null;

    if (goal.jointAccountId) {
      jointAccount = await db.collection('jointAccounts').findOne({
        _id: goal.jointAccountId,
        'members.userId': new ObjectId(userId)
      });
      isJointMember = !!jointAccount;
    }

    if (!isOwner && !isJointMember) {
      return res.status(403).json({ error: 'Not authorized to contribute to this goal' });
    }

    const previousAmount = goal.currentAmount;
    const newAmount = goal.currentAmount + parseFloat(amount);
    const previousPercent = Math.floor((previousAmount / goal.targetAmount) * 100);
    const newPercent = Math.floor((newAmount / goal.targetAmount) * 100);

    await db.collection('goals').updateOne(
      { _id: new ObjectId(goalId) },
      {
        $set: {
          currentAmount: newAmount,
          updatedAt: new Date()
        }
      }
    );

    const updatedGoal = await db.collection('goals').findOne({
      _id: new ObjectId(goalId)
    });

    // Emit socket event
    const io = req.app.get('io');
    if (goal.jointAccountId) {
      io.to(`joint:${goal.jointAccountId}`).emit('goal-updated', updatedGoal);

      // Check for milestone and announce in chat
      const milestones = [25, 50, 75, 100];
      const crossedMilestone = milestones.find(m => previousPercent < m && newPercent >= m);

      if (crossedMilestone) {
        // Get user info
        const user = await db.collection('users').findOne(
          { _id: new ObjectId(userId) },
          { projection: { name: 1, image: 1 } }
        );

        let milestoneEmoji = '🎯';
        let milestoneText = '';
        if (crossedMilestone === 100) {
          milestoneEmoji = '🎉🏆';
          milestoneText = `GOAL REACHED! "${goal.name}" is now 100% funded!`;
        } else {
          milestoneEmoji = crossedMilestone === 75 ? '🔥' : crossedMilestone === 50 ? '⭐' : '✨';
          milestoneText = `${crossedMilestone}% milestone reached for "${goal.name}"!`;
        }

        const chatMessage = {
          jointAccountId: goal.jointAccountId,
          senderId: new ObjectId(userId),
          senderName: user?.name || 'Unknown',
          senderImage: user?.image || null,
          content: `${milestoneEmoji} ${milestoneText}`,
          type: 'goal_milestone',
          milestoneData: {
            goalId: goal._id,
            goalName: goal.name,
            milestone: crossedMilestone,
            currentAmount: newAmount,
            targetAmount: goal.targetAmount,
            contributedBy: user?.name || 'Unknown',
            contributedAmount: parseFloat(amount)
          },
          readBy: [{
            userId: new ObjectId(userId),
            readAt: new Date()
          }],
          createdAt: new Date()
        };

        await db.collection('chatMessages').insertOne(chatMessage);
        io.to(`joint:${goal.jointAccountId}`).emit('new-chat-message', chatMessage);
      }
    }

    res.json(updatedGoal);
  } catch (error) {
    console.error('Contribute to goal error:', error);
    res.status(500).json({ error: 'Failed to contribute to goal' });
  }
});

module.exports = router;
