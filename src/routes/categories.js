const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Default categories
const DEFAULT_CATEGORIES = [
  { name: 'Food', icon: '🍔', color: '#F59E0B', isDefault: true },
  { name: 'Transport', icon: '🚗', color: '#3B82F6', isDefault: true },
  { name: 'Bills', icon: '📄', color: '#EF4444', isDefault: true },
  { name: 'Entertainment', icon: '🎮', color: '#8B5CF6', isDefault: true },
  { name: 'Shopping', icon: '🛍️', color: '#EC4899', isDefault: true },
  { name: 'Health', icon: '💊', color: '#10B981', isDefault: true },
  { name: 'Education', icon: '📚', color: '#6366F1', isDefault: true },
  { name: 'Salary', icon: '💰', color: '#22C55E', isDefault: true, type: 'INCOME' },
  { name: 'Investment', icon: '📈', color: '#14B8A6', isDefault: true, type: 'INCOME' },
  { name: 'Gift', icon: '🎁', color: '#F472B6', isDefault: true, type: 'INCOME' },
  { name: 'Other', icon: '📦', color: '#6B7280', isDefault: true }
];

// GET /api/categories - Get predefined + user custom categories
router.get('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    // Get user's custom categories
    const customCategories = await db.collection('categories')
      .find({ userId: new ObjectId(userId) })
      .toArray();

    // Combine default and custom categories
    const allCategories = [
      ...DEFAULT_CATEGORIES,
      ...customCategories.map(c => ({
        ...c,
        isDefault: false
      }))
    ];

    res.json(allCategories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// POST /api/categories - Create custom category
router.post('/', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;

    const { name, icon, color, type } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check if category with same name already exists for user
    const existing = await db.collection('categories').findOne({
      userId: new ObjectId(userId),
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existing) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    // Check if it's a default category name
    const isDefaultName = DEFAULT_CATEGORIES.some(
      c => c.name.toLowerCase() === name.toLowerCase()
    );

    if (isDefaultName) {
      return res.status(400).json({ error: 'Cannot use default category name' });
    }

    const category = {
      userId: new ObjectId(userId),
      name,
      icon: icon || '📁',
      color: color || '#6B7280',
      type: type || null, // null means both INCOME and EXPENSE
      createdAt: new Date()
    };

    const result = await db.collection('categories').insertOne(category);
    category._id = result.insertedId;

    res.status(201).json(category);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// DELETE /api/categories/:id - Delete custom category
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user._id;
    const categoryId = req.params.id;

    // Find and verify ownership
    const category = await db.collection('categories').findOne({
      _id: new ObjectId(categoryId),
      userId: new ObjectId(userId)
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await db.collection('categories').deleteOne({ _id: new ObjectId(categoryId) });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
