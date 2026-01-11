const crypto = require('crypto');

// Hash password using scrypt with safe parameters
// N=16384, r=8, p=1 (standard secure params that work on all systems)
const hashPassword = async (password) => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(32).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
};

// Verify password against stored hash
const verifyPassword = async (password, storedHash) => {
  return new Promise((resolve, reject) => {
    const [salt, hash] = storedHash.split(':');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex') === hash);
    });
  });
};

// Generate a secure random token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Generate invite code for joint accounts
const generateInviteCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  generateInviteCode
};
