import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { uploadFile, getSignedUrl } from './b2StorageService.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Test uploading a local file to Backblaze B2 and getting a signed URL
async function testUploadAndGetUrl() {
  // Simulate a file object as multer would provide
  const filePath = path.resolve('./test-image.jpeg'); // Place a test-image.jpg in your project root
  if (!fs.existsSync(filePath)) {
    console.error('Test image not found:', filePath);
    return;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const file = {
    originalname: 'test-image.jpeg',
    mimetype: 'image/jpeg',
    buffer: fileBuffer,
  };
  try {
    const fileName = await uploadFile(file);
    console.log('Uploaded fileName:', fileName);
    const signedUrl = await getSignedUrl(fileName);
    console.log('Accessible signed URL:', signedUrl);


    // Test deleting the uploaded file
    await testDeleteFile(fileName);

    
  } catch (err) {
    console.error('Upload or URL generation failed:', err);
  }
}

// Test deleting an uploaded file from Backblaze B2
async function testDeleteFile(fileName) {
  try {
    const { deleteFile } = await import('./b2StorageService.js');
    await deleteFile(fileName);
    console.log('Deleted file from Backblaze:', fileName);
  } catch (deleteErr) {
    console.error('Failed to delete file from Backblaze:', deleteErr);
  }
}

async function testConnection() {
  try {
    // Use the public Railway connection string
    const dbUrl = new URL(process.env.DATABASE_PUBLIC_URI.replace(/^"|"$/g, ''));
    const connection = await mysql.createConnection({
      host: dbUrl.hostname,
      port: dbUrl.port,
      user: dbUrl.username,
      password: dbUrl.password,
      database: dbUrl.pathname.replace(/^\//, ''),
    });
    console.log('Connected to Railway MySQL!');
    const [rows] = await connection.query('SELECT NOW() as now');
    console.log('Test query result:', rows);
    await connection.end();
  } catch (err) {
    console.error('Connection failed:', err);
  }
}

testUploadAndGetUrl();
testConnection();

