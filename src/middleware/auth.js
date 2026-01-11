const jwt = require('jsonwebtoken');
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if session exists and is valid
    const db = getDB();
    const session = await db.collection('sessions').findOne({
      token: token,
      userId: new ObjectId(decoded.userId)
    });

    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Check if session is expired (if expiry is set)
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      await db.collection('sessions').deleteOne({ _id: session._id });
      return res.status(401).json({ error: 'Session expired' });
    }

    // Get user
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { password: 0 } } // Exclude password
    );

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user and token to request
    req.user = user;
    req.token = token;
    req.session = session;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Optional auth - doesn't fail if no token, just doesn't set req.user
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const db = getDB();
    const session = await db.collection('sessions').findOne({
      token: token,
      userId: new ObjectId(decoded.userId)
    });

    if (session) {
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(decoded.userId) },
        { projection: { password: 0 } }
      );
      if (user) {
        req.user = user;
        req.token = token;
        req.session = session;
      }
    }
    
    next();
  } catch (error) {
    // Silently continue without auth
    next();
  }
};

module.exports = { auth, optionalAuth };
