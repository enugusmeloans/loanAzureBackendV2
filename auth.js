// This file configures the authentication strategies using Passport.js, including local and Google OAuth strategies.

import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { OAuth2Strategy as GoogleStrategy } from 'passport-google-oauth';
import dotenv from 'dotenv';
import sql from 'mssql';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();
const config = process.env.DATABASE_URI;

// Debug statements to check environment variables
console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET);

// Configure the local strategy
passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password'
  },
  async (email, password, done) => {
    try {
      const poolConnection = await sql.connect(config);
      const result = await poolConnection.request()
        .input('email', sql.VarChar, email)
        .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

      const user = result.recordset[0];
      poolConnection.close();

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
      const poolConnection = await sql.connect(config);
      let result = await poolConnection.request()
        .input('googleId', sql.VarChar, profile.id)
        .query('SELECT * FROM dbo.Users WHERE oauthId = @googleId');

      let user = result.recordset[0];

      if (!user) {
        // Check if a user with the email already exists
        result = await poolConnection.request()
          .input('email', sql.VarChar, profile.emails[0].value)
          .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        user = result.recordset[0];

        if (user) {
          // Update the oauthId for the existing user -- maybe a worry point here
          // I mean if google can verify the user, then surely updating the oauthId is fine.
          // else we will have to check if the user's oauthId is null or not. if it is null, then we can update it. 
          // if it is not null, then we can't update it and will send a response that user already exists. 
          await poolConnection.request()
            .input('googleId', sql.VarChar, profile.id)
            .input('email', sql.VarChar, profile.emails[0].value)
            .query('UPDATE dbo.Users SET oauthId = @googleId WHERE userEmail = @email');
        } else {
          // Insert a new user record
          await poolConnection.request()
            .input('googleId', sql.VarChar, profile.id)
            .input('email', sql.VarChar, profile.emails[0].value)
            .query('INSERT INTO dbo.Users (oauthId, userEmail) VALUES (@googleId, @email)');
        }

        result = await poolConnection.request()
          .input('googleId', sql.VarChar, profile.id)
          .query('SELECT * FROM dbo.Users WHERE oauthId = @googleId');

        user = result.recordset[0];
      }

      poolConnection.close();
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
