// This file sets up the Express server, middleware, and routes for the application.

import express from 'express';
import cors from 'cors';
import passport from 'passport';
import dotenv from 'dotenv';
import './auth.js'; // Import authentication strategies
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise'; // ✅ NEW: mysql2 for Railway

// Use Blackbase B2 instead
import { uploadFile, listFiles, deleteFile, downloadFile, getSignedUrl } from './b2StorageService.js';

dotenv.config();

// Database connection config for Railway
let dbConfig;
if (process.env.NODE_ENV === 'production') {
  // Internal connection for production (Railway only)
  dbConfig = {
    host: process.env.MYSQL_HOST || 'mysql.railway.internal',
    port: 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
} else {
  // Public connection for development (and fallback for local/any env)
  // Parse from DATABASE_PUBLIC_URI
  const dbUrl = new URL(process.env.DATABASE_PUBLIC_URI.replace(/^"|"$/g, ''));
  dbConfig = {
    host: dbUrl.hostname,
    port: dbUrl.port,
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.replace(/^\//, ''),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

const pool = mysql.createPool(dbConfig);

// Import App routes
import routes from './routes.js';
import authRoutes from './authRoutes.js';
import blobroutes from './blobRoutes.js';
import preset from './passwordResetRoutes.js';
import pdfRoutes from './pdfRoutes.js';
import excelRoutes from './excelRoutes.js';

const port = process.env.PORT || 3000;

const app = express();

const allowedOrigins = [
  'https://sme-loan.onrender.com',
  'https://929f-197-210-54-14.ngrok-free.app',
  'http://localhost:5173',
  'http://192.168.0.149:5173'
];

// CORS Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Explicit header setting middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// JSON & form data middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// JWT Auth middleware
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
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Request logger
console.log('Starting server...');
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log("Request received: ", req.body);
  }
  next();
});

// Connect routes
app.use('/auth', authRoutes);

// ✅ Test MySQL connection
app.get('/test', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Users');
    console.log(rows);
    res.json(rows);
  } catch (error) {
    console.error('MySQL Test Error:', error);
    res.status(500).send('MySQL connection test failed.');
  }
});

// Dummy session routes
app.get('/session-test', (req, res) => {
  res.send('Session test');
});
app.get('/session-check', (req, res) => {
  res.send('Session check');
});

// Protected routes
app.use('/routes', isAuthenticated, routes);

// Blob, reset, pdf, excel
app.use('/blob', blobroutes);
app.use('/reset', preset);
app.use('/pdf', pdfRoutes);
app.use('/excel', excelRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
