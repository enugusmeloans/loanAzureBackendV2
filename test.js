// import mysql from 'mysql2/promise';
// import dotenv from 'dotenv';

// dotenv.config();

// async function testConnection() {
//   try {
//     // Use the public Railway connection string
//     const dbUrl = new URL(process.env.DATABASE_PUBLIC_URI.replace(/^"|"$/g, ''));
//     const connection = await mysql.createConnection({
//       host: dbUrl.hostname,
//       port: dbUrl.port,
//       user: dbUrl.username,
//       password: dbUrl.password,
//       database: dbUrl.pathname.replace(/^\//, ''),
//     });
//     console.log('Connected to Railway MySQL!');
//     const [rows] = await connection.query('SELECT NOW() as now');
//     console.log('Test query result:', rows);
//     await connection.end();
//   } catch (err) {
//     console.error('Connection failed:', err);
//   }
// }

// testConnection();

