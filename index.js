// This file sets up the Express server, middleware, and routes for the application.

import express from 'express';
import cors from 'cors';
import passport from 'passport';
import session from 'express-session';
import MSSQLStore from 'connect-mssql-v2';
import dotenv from 'dotenv';
import './auth.js'; // Import authentication strategies

import { ensureContainerExists } from './azureBlobService.js'; // Import Azure Blob Service logic

dotenv.config();

const config = {
  user: process.env.DB_USER || "master",
  password: process.env.DB_PASSWORD || "OPgames142",
  server: process.env.DB_SERVER || "webgamedbserver.database.windows.net",
  database: process.env.DB_DATABASE || "webgame",
  options: {
    encrypt: true, // Use encryption
    enableArithAbort: true
  }
};
// const config = process.env.DATABASE_URI;

// Import App routes
import routes from './routes.js';
import authRoutes from './authRoutes.js'; // Use import instead of require
import blobroutes from './blobRoutes.js'; // Import routes for Azure Blob Service

const port = process.env.PORT || 3000;

const app = express();

// Use the CORS middleware to allow all origins
app.use(cors({
  origin: ['http://localhost:5500','http://localhost:5173'],
  credentials: true
}));

// Middleware to set headers explicitly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5500');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Middleware for parsing JSON and urlencoded form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const store = new MSSQLStore(config);

store.on('error', (err) => {
  console.error('Session store error:', err);
});

// Session middleware
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  store: store,
  cookie: { 
    secure: false, 
    httpOnly: true, 
    maxAge: 24 * 60 * 60 * 1000 
  } // 1-day expiry
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware to check if user is authenticated
// function isAuthenticated(req, res, next) {
//   console.log('Session:', req.session);
//   console.log('User:', req.user);
//   if (req.isAuthenticated()) {
//     return next();
//   }
//   // res.redirect('http://localhost:5500/index.html'); // Redirect here if not authenticated, typically to login page
//   res.status(401).send('Unauthorized');
// }

console.log('Starting server...');
app.use((req, res, next) => {
  console.log('Session ID:', req.session.id);
  console.log('Session Data:', req.session);
  next();
});

// Connect App routes
app.use('/auth', authRoutes);
// Simple login route for testing
app.get('/login', (req, res) => {
  console.log('we are logging in!')
  res.send('Login Page');
});

app.get('/session-test', (req, res) => {
  req.session.test = 'Session is working!';
  res.send('Session set, now refresh!');
});
app.get('/session-check', (req, res) => {
  res.send(req.session.test || 'Session not found!');
});

// app.use('/routes', isAuthenticated, routes);
app.use('/routes', routes);

// app.use('*', (_, res) => {
//   res.redirect('/api-docs');
// });

// Ensure the Azure Blob Storage container exists
// Ensure the Azure Blob Storage container exists before starting the server
ensureContainerExists().catch((error) => {
  console.error("Error ensuring container exists:", error);
  process.exit(1); // Exit the process if container creation fails
});

// Connect Azure Blob Service routes
app.use('/blob', blobroutes);

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});