import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Configure the email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail', // Use Gmail as the email service
    auth: {
        user: process.env.EMAIL_USER, // Your email address
        pass: process.env.EMAIL_PASSWORD // Your email password or app-specific password
    }
});

// Function to send an email
async function sendEmail(to, subject, body) {
    try {
        console.log(`Sending email to ${to} with subject "${subject}"`);
        const mailOptions = {
            from: process.env.EMAIL_USER, // Sender address
            to, // Recipient address
            subject, // Email subject
            text: body // Email body
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error("Error sending email:", error);
        // throw new Error("Failed to send email");
    }
}

// sendEmail("ultrarenz@gmail.com", "Test Email", "This is a test email.")
// console.log("Email sent successfully.");

export { sendEmail };
