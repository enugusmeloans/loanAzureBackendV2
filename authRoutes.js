// This file defines the authentication routes for local and Google OAuth strategies.

import express from 'express';
import passport from 'passport';
import sql from 'mssql';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const router = express.Router();
const config = process.env.DATABASE_URI;

// Local authentication routes
// router.post('/login', passport.authenticate('local', {
//   successRedirect: 'http://localhost:5500/goodlogin.html', //if local login is successful, redirect to this page
//   failureRedirect: 'http://localhost:5500/failogin.html', // if local login fails, redirect to this page
//   failureFlash: false // Set failureFlash to false - maybe useless, default is false anyway
// }));
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      // return res.redirect('http://localhost:5500/failogin.html');
      return res.status(400).send('User not found');
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      req.session.save((err) => {
        if (err) {
          return next(err);
        }
        // return res.redirect('http://localhost:5500/goodlogin.html');
        return res.status(200).send('Logged in');
      });
    });
  })(req, res, next);
});
// router.post('/login', passport.authenticate('local'), (req, res) => {
//   console.log('User after login:', req.user);
//   console.log('Session after login:', req.session);
//   res.send('Logged in');
// });


router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    /**
     * Hashes the provided password using bcrypt with a salt rounds value of 10.
     * password - The plain text password to be hashed.
     */
    const hashedPassword = await bcrypt.hash(password, 10);
    const userName = email.split('@')[0];
    const poolConnection = await sql.connect(config);
    console.log('signup', email, password, hashedPassword, userName);
    // Insert new user into the database
    const result = await poolConnection.request()
      .input('email', sql.VarChar, email)
      .query('SELECT * FROM dbo.Users WHERE userEmail = @email');
      console.log('signup: user with email', email, 'exists');

    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      if (user.userPassword === null) {
        // User exists but password is null, update the password
        await poolConnection.request()
        .input('email', sql.VarChar, email)
        .input('password', sql.VarChar, hashedPassword)
        .query('UPDATE dbo.Users SET userPassword = @password WHERE userEmail = @email');
        console.log('signup: user with email', email, ' password null, updated');
      } else {
        // User exists and password is not null, respond with User already exists
        poolConnection.close();
        console.log('signup: user with email', email, 'already exists, password not null');
        res.status(400).send('User already exists');
        return;
      }
    } else {
      // User does not exist, insert new user
      await poolConnection.request()
      .input('email', sql.VarChar, email)
      .input('password', sql.VarChar, hashedPassword)
      .input('userName', sql.VarChar, userName)
      .query('INSERT INTO dbo.Users (userEmail, userPassword, userName) VALUES (@email, @password, @userName)');
      console.log('signup: user with email', email, 'does not exist, inserted');
    }

    poolConnection.close();
    console.log('User signed up successfully');
    // res.redirect('/login'); // Redirect to login page on successful signup/resgistration - change later
    // res.redirect('http://localhost:5500/index.html'); // Redirect to login page on successful signup/resgistration - change later
    res.status(200).send('Signed up');
  } catch (err) {
    console.error(err.message);
    res.status(500).send(err.message);
  }

  /**
   * This code snippet handles user signup.
   * It extracts the email and password from the request body, hashes the password using bcrypt,
   * generates a username from the email, connects to the SQL database, and inserts the new user
   * into the Users table. If successful, it redirects the user to the login page. If an error occurs,
   * it logs the error and sends a 500 status response.
   */
});

// Google authentication routes
router.get('/google', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/plus.login'] }));

// router.get('/google/callback', passport.authenticate('google', {
//   successRedirect: '/', // Redirect to home page on successful Google login
//   failureRedirect: '/login'
// }));
router.get('/google/callback', passport.authenticate('google', {
  successRedirect: 'http://localhost:5500/goodlogin.html', // Redirect to home page on successful Google login
  failureRedirect: 'http://localhost:5500/failogin.html' // Redirect to login page on failed Google login
}));

// Logout route
router.get('/logout', (req, res, next) => {
  console.log('Logging out user:', req.user);
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      console.log('User logged out successfully');
      // res.redirect('/'); // Redirect to login page on successful logout
      // res.redirect('http://localhost:5500/index.html'); // Redirect to login page on successful logout
      res.status(200).send('Logged out');
    });
  });
});

export default router;
