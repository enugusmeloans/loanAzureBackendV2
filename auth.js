// This file configures the authentication strategies using Passport.js, including local and Google OAuth strategies.

import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { OAuth2Strategy as GoogleStrategy } from 'passport-google-oauth';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise'; // Use mysql2 for Railway compatibility

dotenv.config();
const config = process.env.NODE_ENV === "production" ? process.env.DATABASE_URI : process.env.DATABASE_PUBLIC_URI;

// Debug statements to check environment variables
// console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
// console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET);

// Configure the local strategy
passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password'
  },
  async (email, password, done) => {
    try {
      // Use mysql2/promise for Railway compatibility
      const dbUrl = new URL((process.env.NODE_ENV === 'production' ? process.env.DATABASE_URI : process.env.DATABASE_PUBLIC_URI).replace(/^"|"$/g, ''));
      const poolConnection = await mysql.createConnection({
        host: dbUrl.hostname,
        port: dbUrl.port,
        user: dbUrl.username,
        password: dbUrl.password,
        database: dbUrl.pathname.replace(/^\//, ''),
      });
      const [rows] = await poolConnection.execute('SELECT * FROM Users WHERE userEmail = ?', [email]);
      const user = rows[0];
      await poolConnection.end();

      if (!user) {
        console.log('Incorrect email.');
        return done(null, false, { message: 'Incorrect email.' });
      }
      const isMatch = await bcrypt.compare(password, user.userPassword);
      if (!isMatch) {
        console.log('Incorrect password.');
        return done(null, false, { message: 'Incorrect password.' });
      }
      console.log('User authenticated.');
      return done(null, user);
    } catch (err) {
      console.log('Error:', err);
      return done(err);
    }
  }
));

// Configure the Google strategy
passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
  },
  async (token, tokenSecret, profile, done) => {
    try {
      console.log('Google profile:', profile);
      const poolConnection = await mysql.createConnection(config);
      // Try to find user by oauthId
      let [rows] = await poolConnection.execute('SELECT * FROM Users WHERE oauthId = ?', [profile.id]);
      let user = rows[0];

      if (!user) {
        // Check if a user with the email already exists
        [rows] = await poolConnection.execute('SELECT * FROM Users WHERE userEmail = ?', [profile.emails[0].value]);
        user = rows[0];

        if (user) {
          // Update the oauthId for the existing user
          await poolConnection.execute('UPDATE Users SET oauthId = ? WHERE userEmail = ?', [profile.id, profile.emails[0].value]);
        } else {
          // Insert a new user record
          await poolConnection.execute('INSERT INTO Users (oauthId, userEmail) VALUES (?, ?)', [profile.id, profile.emails[0].value]);
        }
        // Fetch the user again by oauthId
        [rows] = await poolConnection.execute('SELECT * FROM Users WHERE oauthId = ?', [profile.id]);
        user = rows[0];
      }
      await poolConnection.end();
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Serialize user into the session
passport.serializeUser((user, done) => {
  done(null, user.userId); // Store the userId in the JWT payload
});

passport.deserializeUser((id, done) => {
  done(null, false); // No session-based deserialization
});

// Function to generate a JWT token
function generateToken(user) {
    const payload = { userId: user.userId, email: user.userEmail, adminId: user.adminId };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
}

export { generateToken };
