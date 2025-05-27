import mysql from "mysql2/promise";

const config = process.env.NODE_ENV === "production" ? process.env.DATABASE_URI : process.env.DATABASE_PUBLIC_URI;
/**
 * Function to store a notification in the Notifications table.
 * @param {string} title - The title of the notification.
 * @param {string} userId - The ID of the user to whom the notification belongs.
 * @param {string} body - The body content of the notification.
 * @returns {Promise<void>} - Resolves when the notification is successfully stored.
 */
export async function storeNotification(title, userId, body) {
  try {
    const poolConnection = await mysql.createConnection(config);
    await poolConnection.execute(
      `INSERT INTO Notifications (title, userId, body, createdAt) VALUES (?, ?, ?, NOW())`,
      [title, userId, body]
    );
    await poolConnection.end();
  } catch (error) {
    console.error("Error storing notification:", error);
    // throw new Error("Failed to store notification");
  }
}

// storeNotification("Test Notification", "12345", "This is a test notification.")
// console.log("Notification stored successfully.");