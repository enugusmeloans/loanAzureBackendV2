import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { sendEmail } from './emailService.js';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import { storeNotification } from './notificationService.js';
import mysql from 'mysql2/promise';

dotenv.config();

const router = express.Router();
const config = process.env.NODE_ENV === "production" ? process.env.DATABASE_URI : process.env.DATABASE_PUBLIC_URI;

// Schedule a job to clean up expired reset codes every 2 hours
schedule.scheduleJob('0 */2 * * *', async () => {
    try {
        const poolConnection = await mysql.createConnection(config);
        await poolConnection.execute('DELETE FROM PasswordResetCodes WHERE expirationTime < NOW()');
        await poolConnection.end();
        console.log("Expired reset codes cleaned up successfully.");
    } catch (err) {
        console.error("Error cleaning up expired reset codes:", err.message);
    }
});

// Updated endpoint to request a password reset with resetCode and resetCodeExpiration in a separate table
router.post('/request-password-reset', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Check if the user exists
        const [userRows] = await poolConnection.execute('SELECT * FROM Users WHERE userEmail = ?', [email]);
        const user = userRows[0];
        if (!user) {
            await poolConnection.end();
            return res.status(404).json({ error: "User not found" });
        }

        // Generate a reset code and expiration time
        const resetCode = crypto.randomBytes(3).toString('hex');
        const expirationTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Upsert logic for PasswordResetCodes
        const [resetRows] = await poolConnection.execute('SELECT * FROM PasswordResetCodes WHERE userEmail = ?', [email]);
        if (resetRows.length > 0) {
            await poolConnection.execute('UPDATE PasswordResetCodes SET resetCode = ?, expirationTime = ? WHERE userEmail = ?', [resetCode, expirationTime, email]);
        } else {
            await poolConnection.execute('INSERT INTO PasswordResetCodes (userEmail, resetCode, expirationTime) VALUES (?, ?, ?)', [email, resetCode, expirationTime]);
        }
        await poolConnection.end();

        // Send the reset code to the user's email
        await sendEmail(email, "Password Reset Code", `Your password reset code is: ${resetCode}`);

        res.status(200).json({ message: "Password reset code sent to your email" });
    } catch (err) {
        console.error("Error requesting password reset:", err.message);
        res.status(500).json({ error: "Failed to request password reset" });
    }
});

// Updated endpoint to reset the password
router.post('/reset-password', async (req, res) => {
    try {
        const { email, resetCode, newPassword } = req.body;

        if (!email || !resetCode || !newPassword) {
            return res.status(400).json({ error: "Email, reset code, and new password are required" });
        }

        const poolConnection = await mysql.createConnection(config);

        // Check if the reset code is valid
        const [resetRows] = await poolConnection.execute('SELECT * FROM PasswordResetCodes WHERE userEmail = ?', [email]);
        const resetRecord = resetRows[0];
        if (!resetRecord || resetRecord.resetCode !== resetCode || new Date(resetRecord.expirationTime) < new Date()) {
            await poolConnection.end();
            return res.status(400).json({ error: "Invalid or expired reset code" });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password
        await poolConnection.execute('UPDATE Users SET userPassword = ? WHERE userEmail = ?', [hashedPassword, email]);

        // Delete the reset code record
        await poolConnection.execute('DELETE FROM PasswordResetCodes WHERE userEmail = ?', [email]);
        await poolConnection.end();

        // Send a confirmation email
        await sendEmail(email, "Password Reset Confirmation", "Your password has been reset successfully.");
        // Send a notification to the user
        await storeNotification("Password Reset", resetRecord.userId, "Your password has been reset successfully.");

        res.status(200).json({ message: "Password reset successfully" });
    } catch (err) {
        console.error("Error resetting password:", err.message);
        res.status(500).json({ error: "Failed to reset password" });
    }
});

export default router;