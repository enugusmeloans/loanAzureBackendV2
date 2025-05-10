import express from 'express';
import sql from 'mssql';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { sendEmail } from './emailService.js';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import { storeNotification } from './notificationService.js';

dotenv.config();

const router = express.Router();
const config = process.env.DATABASE_URI;

// Schedule a job to clean up expired reset codes every 2 hours
schedule.scheduleJob('0 */2 * * *', async () => {
    try {
        const poolConnection = await sql.connect(config);

        // Delete expired reset codes
        await poolConnection.request()
            .query(`DELETE FROM dbo.PasswordResetCodes WHERE expirationTime < GETDATE()`);

        poolConnection.close();
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

        const poolConnection = await sql.connect(config);

        // Check if the user exists
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.Users WHERE userEmail = @email');

        const user = result.recordset[0];
        if (!user) {
            poolConnection.close();
            return res.status(404).json({ error: "User not found" });
        }

        // Generate a reset code and expiration time
        const resetCode = crypto.randomBytes(3).toString('hex');
        const expirationTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // This SQL query checks if a record exists in the dbo.PasswordResetCodes table for the given email.
        // - If a record exists (using IF EXISTS with a SELECT query), it updates the resetCode and expirationTime for that email.
        // - If no record exists, it inserts a new record with the provided email, resetCode, and expirationTime.
        await poolConnection.request()
            .input('email', sql.VarChar, email)
            .input('resetCode', sql.VarChar, resetCode)
            .input('expirationTime', sql.DateTime, expirationTime)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.PasswordResetCodes WHERE userEmail = @email)
                BEGIN
                    UPDATE dbo.PasswordResetCodes
                    SET resetCode = @resetCode, expirationTime = @expirationTime
                    WHERE userEmail = @email
                END
                ELSE
                BEGIN
                    INSERT INTO dbo.PasswordResetCodes (userEmail, resetCode, expirationTime)
                    VALUES (@email, @resetCode, @expirationTime)
                END
            `);

        poolConnection.close();

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

        const poolConnection = await sql.connect(config);

        // Check if the reset code is valid
        const result = await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM dbo.PasswordResetCodes WHERE userEmail = @email');

        const resetRecord = result.recordset[0];
        if (!resetRecord || resetRecord.resetCode !== resetCode || new Date(resetRecord.expirationTime) < new Date()) {
            poolConnection.close();
            return res.status(400).json({ error: "Invalid or expired reset code" });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password
        await poolConnection.request()
            .input('email', sql.VarChar, email)
            .input('hashedPassword', sql.VarChar, hashedPassword)
            .query('UPDATE dbo.Users SET userPassword = @hashedPassword WHERE userEmail = @email');

        // Delete the reset code record
        await poolConnection.request()
            .input('email', sql.VarChar, email)
            .query('DELETE FROM dbo.PasswordResetCodes WHERE userEmail = @email');

        poolConnection.close();
        // Send a confirmation email
        await sendEmail(email, "Password Reset Confirmation", "Your password has been reset successfully.");
        // Send a notification to the user
        await storeNotification("Password Reset", user.userId, "Your password has been reset successfully.");

        res.status(200).json({ message: "Password reset successfully" });
    } catch (err) {
        console.error("Error resetting password:", err.message);
        res.status(500).json({ error: "Failed to reset password" });
    }
});

export default router;