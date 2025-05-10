import sql from "mssql";

/**
 * Function to store a notification in the Notifications table.
 * @param {string} title - The title of the notification.
 * @param {string} userId - The ID of the user to whom the notification belongs.
 * @param {string} body - The body content of the notification.
 * @returns {Promise<void>} - Resolves when the notification is successfully stored.
 */
export async function storeNotification(title, userId, body) {
  try {
    const poolConnection = await sql.connect(process.env.DATABASE_URI);

    await poolConnection.request()
      .input("title", sql.VarChar, title)
      .input("userId", sql.VarChar, userId)
      .input("body", sql.Text, body)
      .query(`
        INSERT INTO Notifications (title, userId, body, createdAt)
        VALUES (@title, @userId, @body, GETDATE())
      `);

    poolConnection.close();
  } catch (error) {
    console.error("Error storing notification:", error);
    throw new Error("Failed to store notification");
  }
}

storeNotification("Test Notification", "12345", "This is a test notification.")
console.log("Notification stored successfully.");