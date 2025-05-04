// This file sets up the Express server, middleware, and routes for the application.

import express from 'express';
import cors from 'cors';
import passport from 'passport';
import dotenv from 'dotenv';
import './auth.js'; // Import authentication strategies
import jwt from 'jsonwebtoken';

import { ensureContainerExists } from './azureBlobService.js'; // Import Azure Blob Service logic

dotenv.config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
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
import preset from './passwordResetRoutes.js' // Import password reset routes
import pdfRoutes from './pdfRoutes.js'; // Import PDF generation routes
import excelRoutes from './excelRoutes.js'; // Import Excel generation routes

const port = process.env.PORT || 3000;

const app = express();

// Use the CORS middleware to allow all origins
app.use(cors({
  origin: ['http://localhost:5500','http://localhost:5173'],
  credentials: true
}));

// Middleware to set headers explicitly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Middleware for parsing JSON and urlencoded form data
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware to check if user is authenticated using JWT
function isAuthenticated(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

console.log('Starting server...');
app.use((req, res, next) => {
  console.log("Hello from the middleware!");
  // console.log('Session Data:', req.session);
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
  // req.session.test = 'Session is working!';
  res.send('Session set, now refresh!');
});
app.get('/session-check', (req, res) => {
  // res.send(req.session.test || 'Session not found!');
  res.send('Session not found!');
});

// app.use('/routes', isAuthenticated, routes);
app.use('/routes', isAuthenticated, routes);

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

// Connect password reset routes
app.use('/reset', preset);

// Connect PDF generation routes
app.use('/pdf', pdfRoutes);

// Connect Excel generation routes
app.use('/excel', excelRoutes);

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});