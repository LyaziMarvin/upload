const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getAsync, runAsync } = require('../database/db'); // path relative to this file

const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-secret';

// Map DB row to a safe user object
function shapeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    phone: row.phone ?? null,
    age: row.age ?? null,
    dob: row.dob ?? null, // ISO: YYYY-MM-DD
    gender: row.gender ?? null,
    profile_photo_path: row.profile_photo_path ?? null,
  };
}

module.exports = {
  registerUser: async ({ email, password }) => {
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      await runAsync(
        'INSERT INTO users (email, password) VALUES (?, ?)',
        [email, hashedPassword]
      );
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
        throw new Error('Email already registered');
      }
      throw err;
    }
  },

  validateLogin: async ({ email, password }) => {
    const user = await getAsync('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) throw new Error('User not found');
    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new Error('Invalid password');
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' } // extended session
    );
    return token;
  },

  decodeToken: (token) => {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
  },

  findUserByEmail: (email) => getAsync('SELECT * FROM users WHERE email = ?', [email]),
  checkPassword: (raw, hash) => bcrypt.compare(raw, hash),

  getCurrentUser: async (token) => {
    const decoded = module.exports.decodeToken(token);
    if (!decoded?.userId) return null;

    const row = await getAsync(
      `SELECT id, email, name, phone, age, dob, gender, profile_photo_path
         FROM users WHERE id = ?`,
      [decoded.userId]
    );
    return shapeUser(row);
  },

  // Optional: centralize updates here (IPC can call this)
  updateProfile: async (userId, profile = {}) => {
    const current = await getAsync(
      `SELECT id, email, name, phone, age, dob, gender, profile_photo_path
       FROM users WHERE id = ?`,
      [userId]
    );
    if (!current) throw new Error('User not found');

    const merged = {
      email: (profile.email ?? current.email),
      name: (profile.name ?? current.name ?? null),
      phone: (profile.phone ?? current.phone ?? null),
      age: (profile.age !== undefined && profile.age !== '' ? Number(profile.age) : current.age ?? null),
      dob: (profile.dob ?? current.dob ?? null),
      gender: (profile.gender ?? current.gender ?? null),
      profile_photo_path: (profile.profile_photo_path ?? current.profile_photo_path ?? null),
    };

    await runAsync(
      `UPDATE users
         SET email = ?, name = ?, phone = ?, age = ?, dob = ?, gender = ?, profile_photo_path = ?
       WHERE id = ?`,
      [
        merged.email,
        merged.name,
        merged.phone,
        merged.age,
        merged.dob,
        merged.gender,
        merged.profile_photo_path,
        userId
      ]
    );

    const fresh = await getAsync(
      `SELECT id, email, name, phone, age, dob, gender, profile_photo_path
       FROM users WHERE id = ?`,
      [userId]
    );
    return shapeUser(fresh);
  }
};
