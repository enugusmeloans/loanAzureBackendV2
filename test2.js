// import mysql from 'mysql2/promise';
// import dotenv from 'dotenv';

// dotenv.config();

// async function testPrivateConnection() {
//   try {
//     // Use the internal Railway connection variables
//     const connection = await mysql.createConnection({
//       host: process.env.MYSQL_HOST || 'mysql.railway.internal',
//       port: 3306,
//       user: process.env.MYSQL_USER,
//       password: process.env.MYSQL_PASSWORD,
//       database: process.env.MYSQL_DATABASE,
//     });
//     console.log('Connected to Railway MySQL (private/internal)!');
//     const [rows] = await connection.query('SELECT NOW() as now');
//     console.log('Test query result:', rows);
//     await connection.end();
//   } catch (err) {
//     console.error('Private connection failed:', err);
//   }
// }

// testPrivateConnection();
