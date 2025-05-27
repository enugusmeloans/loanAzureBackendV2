// This file defines the authentication routes for local and Google OAuth strategies.

import express from 'express';
import passport from 'passport';
import sql from 'mssql';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise'; // Use mysql2 for Railway compatibility

dotenv.config();

const router = express.Router();
const config = process.env.NODE_ENV === "production" ? process.env.DATABASE_URI : process.env.DATABASE_PUBLIC_URI;
const jwtSecret = process.env.JWT_SECRET; // Ensure this is set in your environment variables

// Local authentication routes
router.post('/login', (req, res, next) => {
  console.log("user logging in")
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(400).json({ success:false, message: 'User not found' });
    }
    const { userPassword, ...userWithoutPassword } = user;
    const token = jwt.sign(userWithoutPassword, jwtSecret, { expiresIn: '3h' });
    return res.status(200).json({ success:true, message: 'Logged in', data: { user: userWithoutPassword, token } });
  })(req, res, next);
});

router.post('/signup', async (req, res) => {
  try {
    const { email, password, phoneNumber } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userName = email.split('@')[0];

    const poolConnection = await mysql.createConnection(config);

    // Check if user already exists
    console.log('Checking if user exists with email:', email);
    const [existingUserRows] = await poolConnection.query(
      'SELECT * FROM Users WHERE userEmail = ?',
      [email]
    );

    if (existingUserRows.length > 0) {
      const user = existingUserRows[0];

      if (user.userPassword === null) {
        console.log('User exists with no password, updating password');
        // User exists with no password (OAuth user) - update password
        await poolConnection.query(
          'UPDATE Users SET userPassword = ? WHERE userEmail = ?',
          [hashedPassword, email]
        );
      } else {
        // User exists with a password already
        await poolConnection.end();
        return res.status(400).json({ success: false, message: 'User already exists' });
      }
    } else {
      // Insert new user
      await poolConnection.query(
        'INSERT INTO Users (userEmail, userPassword, userName) VALUES (?, ?, ?)',
        [email, hashedPassword, userName]
      );
    }

    // Get userId for ExtraUserDetails
    console.log('Fetching userId for ExtraUserDetails:', email);
    const [userIdRows] = await poolConnection.query(
      'SELECT userId FROM Users WHERE userEmail = ?',
      [email]
    );

    if (userIdRows.length === 0) {
      throw new Error('User ID not found after user creation');
    }

    const userId = userIdRows[0].userId;

    // Insert ExtraUserDetails
    await poolConnection.query(
      'INSERT INTO ExtraUserDetails (userId, phoneNumber) VALUES (?, ?)',
      [userId, phoneNumber]
    );

    // JWT
    const userWithoutPassword = { userEmail: email, userName, phoneNumber };
    const token = jwt.sign(userWithoutPassword, jwtSecret, { expiresIn: '3h' });

    await poolConnection.end();

    res.status(200).json({
      success: true,
      message: 'Signed up',
      data: { user: userWithoutPassword, token },
    });
  } catch (err) {
    console.error('Signup Error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Error Signing Up',
      data: { error: err.message },
    });
  }
});

// Google authentication routes
router.get('/google', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/plus.login'] }));

router.get('/google/callback', passport.authenticate('google', {
  successRedirect: 'http://localhost:5500/goodlogin.html', // Redirect to home page on successful Google login
  failureRedirect: 'http://localhost:5500/' // Redirect to login page on failed Google login
}));

export default router;
