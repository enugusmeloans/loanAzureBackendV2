// This file defines the authentication routes for local and Google OAuth strategies.

import express from 'express';
import passport from 'passport';
import sql from 'mssql';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();

const router = express.Router();
const config = process.env.DATABASE_URI;
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
    const { email, password,phoneNumber } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userName = email.split('@')[0];
    const poolConnection = await sql.connect(config);

    const result = await poolConnection.request()
      .input('email', sql.VarChar, email)
      .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

    // Check if the user already exists
    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      // If the user exists but has no password, update the password
      // Otherwise, return an error message
      if (user.userPassword === null) {
        await poolConnection.request()
          .input('email', sql.VarChar, email)
          .input('password', sql.VarChar, hashedPassword)
          .query('UPDATE dbo.Users SET userPassword = @password WHERE userEmail = @email');
          
      } else {
        poolConnection.close();
        return res.status(400).json({ success: false, message: 'User already exists' });
      }
    } else {
      // If the user does not exist, create a new user
      await poolConnection.request()
        .input('email', sql.VarChar, email)
        .input('password', sql.VarChar, hashedPassword)
        .input('userName', sql.VarChar, userName)
        .query('INSERT INTO dbo.Users (userEmail, userPassword, userName) VALUES (@email, @password, @userName)');

      const userIdResult = await poolConnection.request()
        .input('email', sql.VarChar, email)
        .query('SELECT userId FROM dbo.Users WHERE userEmail = @email');

      if (userIdResult.recordset.length === 0) {
        throw new Error('User ID not found after user creation');
      }

      const userId = userIdResult.recordset[0].userId;

      await poolConnection.request()
        .input('userId', sql.Int, userId)
        .input('phoneNumber', sql.BigInt, phoneNumber)
        .query('INSERT INTO dbo.ExtraUserDetails (userId, phoneNumber) VALUES (@userId, @phoneNumber)');
    }


    // Generate a JWT token for the user
    // Exclude the password from the user object before signing the token
    const userWithoutPassword = { userEmail: email, userName:userName, phoneNumber:phoneNumber };
    const token = jwt.sign(userWithoutPassword, jwtSecret, { expiresIn: '3h' });

    poolConnection.close();
    res.status(200).json({ success:true, message: 'Signed up', data:{ user: userWithoutPassword, token } });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success:false, message: 'Error Signing Up', data:{ error: err.message } });
  }
});

// Google authentication routes
router.get('/google', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/plus.login'] }));

router.get('/google/callback', passport.authenticate('google', {
  successRedirect: 'http://localhost:5500/goodlogin.html', // Redirect to home page on successful Google login
  failureRedirect: 'http://localhost:5500/' // Redirect to login page on failed Google login
}));

export default router;
