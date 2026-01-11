const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { hashPassword, verifyPassword, generateToken } = require('../utils/crypto');
const { auth } = require('../middleware/auth');
const { sendPasswordResetEmail, sendVerificationCodeEmail } = require('../services/emailService');
const admin = require('firebase-admin');

const router = express.Router();

// Initialize Firebase Admin if not already initialized
let firebaseInitialized = false;
const initFirebase = () => {
  if (firebaseInitialized) return;
  
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
  }
};

// Initialize Firebase on module load
initFirebase();

// Create JWT token
const createJWTToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '365d' } // 1 year expiry
  );
};

// Create session in database
const createSession = async (userId, token) => {
  const db = getDB();
  const session = {
    userId: new ObjectId(userId),
    token: token,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    createdAt: new Date()
  };
  
  await db.collection('sessions').insertOne(session);
  return session;
};

// Initialize user settings
const initUserSettings = async (userId) => {
  const db = getDB();
  const existingSettings = await db.collection('settings').findOne({ userId: new ObjectId(userId) });
  
  if (!existingSettings) {
    await db.collection('settings').insertOne({
      userId: new ObjectId(userId),
      primaryCurrency: 'PHP',
      theme: 'dark',
      notificationsEnabled: true,
      tutorialCompleted: false,
      createdAt: new Date()
    });
  }
};

// POST /api/auth/send-verification - Send 6-digit verification code
router.post('/send-verification', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store pending verification (expires in 10 minutes)
    await db.collection('pendingVerifications').updateOne(
      { email: normalizedEmail },
      {
        $set: {
          email: normalizedEmail,
          code: code,
          name: name || normalizedEmail.split('@')[0],
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    // Send verification email
    await sendVerificationCodeEmail(normalizedEmail, code, name || normalizedEmail.split('@')[0]);

    console.log('Verification code sent to:', normalizedEmail);
    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// POST /api/auth/register - Email/password signup
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, verificationCode } = req.body;
    console.log('Register attempt for:', email);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (!verificationCode) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Verify the code
    const pendingVerification = await db.collection('pendingVerifications').findOne({
      email: normalizedEmail,
      code: verificationCode,
      expiresAt: { $gt: new Date() }
    });

    if (!pendingVerification) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Delete the used verification code
    await db.collection('pendingVerifications').deleteOne({ _id: pendingVerification._id });

    // Hash password
    const hashedPassword = await hashPassword(password);
    console.log('Password hashed successfully');

    // Create user
    const user = {
      email: normalizedEmail,
      password: hashedPassword,
      name: name || normalizedEmail.split('@')[0],
      image: null,
      googleId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('users').insertOne(user);
    console.log('User created with ID:', result.insertedId);
    const userId = result.insertedId;

    // Initialize user settings
    await initUserSettings(userId);

    // Create JWT token and session
    const token = createJWTToken(userId);
    await createSession(userId, token);

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;
    userWithoutPassword._id = userId;

    res.status(201).json({
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login - Email/password login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await db.collection('users').findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user has a password (might be Google-only account)
    if (!user.password) {
      return res.status(401).json({ error: 'Please use Google sign-in for this account' });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT token and session
    const token = createJWTToken(user._id);
    await createSession(user._id, token);

    // Update last login
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { updatedAt: new Date() } }
    );

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google - Google sign-in with Firebase ID token
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    if (!email) {
      return res.status(400).json({ error: 'Email is required from Google account' });
    }

    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists with this email
    let user = await db.collection('users').findOne({ email: normalizedEmail });

    if (user) {
      // User exists - update Google info
      const updateFields = {
        updatedAt: new Date()
      };
      
      // Link Google account if not already linked
      if (!user.googleId) {
        updateFields.googleId = uid;
      }
      
      // Update name if user doesn't have one
      if (!user.name && name) {
        updateFields.name = name;
      }
      
      // Only set Google profile picture if user doesn't have a custom one
      // Custom images are base64 (start with 'data:'), Google images are URLs
      if (picture && !user.image) {
        updateFields.image = picture;
      }
      
      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: updateFields }
      );
      
      // Update local user object
      user.googleId = user.googleId || uid;
      user.name = user.name || name;
      if (picture && !user.image) user.image = picture;
    } else {
      // Create new user
      const newUser = {
        email: normalizedEmail,
        password: null, // No password for Google-only users
        name: name || normalizedEmail.split('@')[0],
        image: picture || null,
        googleId: uid,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('users').insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };

      // Initialize user settings
      await initUserSettings(user._id);
    }

    // Create JWT token and session
    const token = createJWTToken(user._id);
    await createSession(user._id, token);

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Google auth error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Google token expired' });
    }
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// POST /api/auth/logout - Invalidate session
router.post('/logout', auth, async (req, res) => {
  try {
    const db = getDB();
    
    // Delete the current session
    await db.collection('sessions').deleteOne({ token: req.token });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const db = getDB();
    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await db.collection('users').findOne({ email: normalizedEmail });
    
    // Always return success even if user not found (security best practice)
    if (!user) {
      return res.json({ message: 'If an account exists, a reset link has been sent' });
    }

    // Check if user is Google-only (no password)
    if (user.googleId && !user.password) {
      return res.status(400).json({ 
        error: 'This account uses Google Sign-In. Please sign in with Google.' 
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save reset token to database
    await db.collection('users').updateOne(
      { _id: user._id },
      { 
        $set: { 
          resetToken: resetTokenHash,
          resetTokenExpires: resetExpires
        } 
      }
    );

    // Send email
    await sendPasswordResetEmail(normalizedEmail, resetToken, user.name);

    res.json({ message: 'If an account exists, a reset link has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// GET /api/auth/verify-reset-token - Verify reset token is valid
router.get('/verify-reset-token', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const db = getDB();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token
    const user = await db.collection('users').findOne({
      resetToken: tokenHash,
      resetTokenExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Verify reset token error:', error);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDB();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token
    const user = await db.collection('users').findOne({
      resetToken: tokenHash,
      resetTokenExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update password and clear reset token
    await db.collection('users').updateOne(
      { _id: user._id },
      { 
        $set: { 
          password: hashedPassword,
          updatedAt: new Date()
        },
        $unset: {
          resetToken: '',
          resetTokenExpires: ''
        }
      }
    );

    // Invalidate all existing sessions for security
    await db.collection('sessions').deleteMany({ userId: user._id });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
