import express from "express";
import { uploadFile, listFiles, deleteFile, getSignedUrl } from './b2StorageService.js';
import sql from "mssql"; // Import SQL for database operations
import jwt from "jsonwebtoken"; // Import JWT for authentication
import archiver from "archiver"; // Import archiver for zipping files
import { storeNotification } from "./notificationService.js";
import { sendEmail } from "./emailService.js"; // Import email service for sending emails
import dotenv from "dotenv"; // Import dotenv for environment variables
dotenv.config(); // Load environment variables from .env file
import multer from "multer";


const router = express.Router();
const storage = multer.memoryStorage(); // Configure multer to store files in memory
const upload = multer({ storage }); // Initialize multer with the memory storage

// Authentication middleware
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

// Authorization middleware to check if the user is an admin
async function isAdmin(req, res, next) {
  if (!req.user || !req.user.adminId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const poolConnection = await sql.connect(process.env.DATABASE_URI);
    const result = await poolConnection.request()
      .input('adminId', sql.VarChar, req.user.adminId)
      .query('SELECT * FROM dbo.Admins WHERE adminId = @adminId');

    const admin = result.recordset[0];
    poolConnection.close();

    if (admin && admin.userId === req.user.userId) {
      return next();
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// Route to upload a single image (Backblaze B2)
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const fileName = await uploadFile(req.file);
    res.status(200).json({ fileName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to upload multiple images (Backblaze B2)
router.post("/upload-multiple", upload.array("images", 10), async (req, res) => {
  try {
    const fileNames = await Promise.all(req.files.map(file => uploadFile(file)));
    res.status(200).json({ fileNames });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to fetch all images (returns file names)
router.get("/images", async (req, res) => {
  try {
    const fileNames = await listFiles();
    res.status(200).json({ fileNames });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to get a signed download URL for a file
router.get("/download/:fileName", async (req, res) => {
  try {
    const { fileName } = req.params;
    const signedUrl = await getSignedUrl(fileName);
    res.status(200).json({ url: signedUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to delete a single image (Backblaze B2)
router.delete("/delete/:fileName", async (req, res) => {
  try {
    await deleteFile(req.params.fileName);
    res.status(200).json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to delete multiple images
router.delete("/delete-multiple", async (req, res) => {
  try {
    const { blobNames } = req.body; // Expecting an array of blob names in the request body
    if (!blobNames || !Array.isArray(blobNames) || blobNames.length === 0) {
      return res.status(400).json({ error: "No blob names provided" }); // Validate blob names
    }

    for (const blobName of blobNames) {
      await deleteFile(blobName); // Delete each image
    }
    res.json({ message: "Images deleted successfully" }); // Respond with success message
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Route to upload or update document images and store URLs in the database
router.post("/upload-documents", upload.fields([
  { name: "idCard", maxCount: 1 },
  { name: "businessCertificate", maxCount: 1 }
]), async (req, res) => {
  try {
    const { applicationId, CAC } = req.body;

    // Validate applicationId, CAC, and files
    if (!applicationId) return res.status(400).json({ success: false, message: "Application ID is required" });
    if (!CAC) return res.status(400).json({ success: false, message: "CAC is required" });
    if (!req.files || !req.files.idCard || !req.files.businessCertificate) {
      return res.status(400).json({ success: false, message: "All document images are required" });
    }

    const poolConnection = await sql.connect(process.env.DATABASE_URI);

    // Check if the application's loanStatus is "Accepted1"
    const applicationResult = await poolConnection.request()
      .input("applicationId", sql.Int, applicationId)
      .query(`
                SELECT loanStatus 
                FROM dbo.Applications 
                WHERE applicationId = @applicationId
            `);

    if (applicationResult.recordset.length === 0) {
      poolConnection.close();
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const { loanStatus } = applicationResult.recordset[0];
    if (loanStatus !== "Accepted1") {
      poolConnection.close();
      return res.status(400).json({ success: false, message: "Application is ineligible for document upload" });
    }

    // Check if the application already exists in the database
    const existingRecord = await poolConnection.request()
      .input("applicationId", sql.Int, applicationId)
      .query(`
                SELECT IdCardLink, businessCertificateLink
                FROM dbo.UploadDocuments
                WHERE applicationId = @applicationId
            `);

    if (existingRecord.recordset.length > 0) {
      // Delete previous images from Azure Blob Storage
      const previousImages = existingRecord.recordset[0];
      if (previousImages.IdCardLink) await deleteFile(previousImages.IdCardLink.split("/").pop());
      if (previousImages.businessCertificateLink) await deleteFile(previousImages.businessCertificateLink.split("/").pop());

      // Update the existing record with new image URLs and CAC
      const idCardUrl = await uploadFile(req.files.idCard[0]);
      const businessCertificateUrl = await uploadFile(req.files.businessCertificate[0]);

      await poolConnection.request()
        .input("applicationId", sql.Int, applicationId)
        .input("idCardLink", sql.VarChar, idCardUrl)
        .input("businessCertificateLink", sql.VarChar, businessCertificateUrl)
        .input("CAC", sql.BigInt, CAC)
        .query(`
                    UPDATE dbo.UploadDocuments
                    SET IdCardLink = @idCardLink,
                        businessCertificateLink = @businessCertificateLink,
                        CAC = @CAC
                    WHERE applicationId = @applicationId
                `);

      // Update loanStatus to "Pending"
      await poolConnection.request()
        .input("applicationId", sql.Int, applicationId)
        .input("loanStatus", sql.VarChar, "Pending")
        .query(`
                    UPDATE dbo.Applications
                    SET loanStatus = @loanStatus
                    WHERE applicationId = @applicationId
                `);

      // Use applicationId to get userId
      const userResult = await poolConnection.request()
        .input("applicationId", sql.Int, applicationId)
        .query(`
          SELECT userId 
          FROM dbo.Applications 
          WHERE applicationId = @applicationId
        `);

      if (userResult.recordset.length === 0) {
        poolConnection.close();
        return res.status(404).json({ success: false, message: "User not found for the given application" });
      }

      const { userId } = userResult.recordset[0];
      poolConnection.close()

      // Send an email notification to the user
      await sendEmail(userId, "Documents Uploaded", "Your documents have been uploaded successfully.");

      // Store notification in the database
      await storeNotification("Documents Uploaded Successfully", userId, "Your Documents have been uploaded. Please await final approval")

      res.json({
        success: true,
        message: "Documents updated successfully",
        data: {
          idCardUrl: idCardUrl,
          businessCertificateUrl: businessCertificateUrl
        }
      });
    } else {
      // Insert new record if the application does not exist
      const idCardUrl = await uploadFile(req.files.idCard[0]);
      const businessCertificateUrl = await uploadFile(req.files.businessCertificate[0]);

      await poolConnection.request()
        .input("applicationId", sql.Int, applicationId)
        .input("idCardLink", sql.VarChar, idCardUrl)
        .input("businessCertificateLink", sql.VarChar, businessCertificateUrl)
        .input("CAC", sql.VarChar, CAC)
        .query(`
                    INSERT INTO dbo.UploadDocuments (applicationId, IdCardLink, businessCertificateLink, CAC)
                    VALUES (@applicationId, @idCardLink, @businessCertificateLink, @CAC)
                `);

      // Update loanStatus to "Pending"
      await poolConnection.request()
        .input("applicationId", sql.Int, applicationId)
        .input("loanStatus", sql.VarChar, "Pending")
        .query(`
                    UPDATE dbo.Applications
                    SET loanStatus = @loanStatus
                    WHERE applicationId = @applicationId
                `);
      
       // Use applicationId to get userId
      const userResult = await poolConnection.request()
        .input("applicationId", sql.Int, applicationId)
        .query(`
          SELECT userId 
          FROM dbo.Applications 
          WHERE applicationId = @applicationId
        `);

      if (userResult.recordset.length === 0) {
        poolConnection.close();
        return res.status(404).json({ success: false, message: "User not found for the given application" });
      }

      const { userId } = userResult.recordset[0];
      poolConnection.close()

      // Store notification in the database
      await storeNotification("Documents Uploaded Successfully", userId, "Your Documents have been uploaded. Please await final approval")

      // Send an email notification to the user
      await sendEmail(userId, "Documents Uploaded", "Your documents have been uploaded successfully.");

      res.json({
        success: true,
        message: "Documents uploaded and stored successfully",
        data: {
          loanStatus: "Pending",
          idCardUrl: idCardUrl,
          businessCertificateUrl: businessCertificateUrl
        }
      });
    }

    poolConnection.close();
  } catch (error) {
    console.error("Upload Documents Error:", error);
    res.status(500).json({ success: false, message: "Failed to upload documents" });
  }
});

// Route to get the images (documents) of an application
router.get("/application-images/:applicationId", async (req, res) => {
  try {
    const { applicationId } = req.params;

    // Validate applicationId
    if (!applicationId) return res.status(400).json({ success: false, message: "Application ID is required" }); 

    const poolConnection = await sql.connect(process.env.DATABASE_URI);

    // Fetch the image URLs from the database
    const result = await poolConnection.request()
      .input("applicationId", sql.Int, applicationId)
      .query(`
                SELECT IdCardLink, businessCertificateLink
                FROM dbo.UploadDocuments
                WHERE applicationId = @applicationId
            `);

    poolConnection.close();

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No images found for this application" });
    }

    const { IdCardLink, businessCertificateLink } = result.recordset[0];

    // Generate SAS tokens for the image URLs
    const idCardSasUrl = IdCardLink ? await generateSasUrl(IdCardLink) : null;
    const businessCertificateSasUrl = businessCertificateLink ? await generateSasUrl(businessCertificateLink) : null;

    console.log("Sassy Urls are: ",idCardSasUrl, businessCertificateSasUrl)

    res.json({
        success: true,
      message: "Application images retrieved successfully",
      data: {
        idCardUrl: idCardSasUrl,
        businessCertificateUrl: businessCertificateSasUrl
      }
    });
  } catch (error) {
    console.error("Fetch Application Images Error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch application images" });
  }
});

// Route to download all images of an application as a zip file
router.get("/download-application-images/:applicationId", async (req, res) => {
  try {
    const { applicationId } = req.params;

    // Validate applicationId
    if (!applicationId) {
      return res.status(400).json({ success: false, message: "Application ID is required" });
    }

    const poolConnection = await sql.connect(process.env.DATABASE_URI);

    // Fetch the image URLs from the database
    const result = await poolConnection.request()
      .input("applicationId", sql.Int, applicationId)
      .query(`
        SELECT IdCardLink, businessCertificateLink
        FROM dbo.UploadDocuments
        WHERE applicationId = @applicationId
      `);

    poolConnection.close();

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No images found for this application" });
    }

    const { IdCardLink, businessCertificateLink } = result.recordset[0];

    // Validate that at least one image exists
    if (!IdCardLink && !businessCertificateLink) {
      return res.status(404).json({ success: false, message: "No images available for download" });
    }

    // Create a zip archive
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Set the response headers for downloading a zip file
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=application_${applicationId}_images.zip`);

    // Pipe the archive to the response
    archive.pipe(res);

    // Add images to the archive
    if (IdCardLink) {
      const idCardStream = await downloadFile(IdCardLink);
      archive.append(idCardStream, { name: "idCard.jpg" });
    }

    if (businessCertificateLink) {
      const businessCertificateStream = await downloadFile(businessCertificateLink);
      archive.append(businessCertificateStream, { name: "businessCertificate.jpg" });
    }

    // Finalize the archive
    await archive.finalize();
  } catch (error) {
    console.error("Download Application Images Error:", error);
    res.status(500).json({ success: false, message: "Failed to download application images" });
  }
});

// Dummy function to check NIN
function checkNIN(number) {
  // For now, always return true
  return true;
}

// Dummy function to verify CAC
function verifyCAC(number) {
  // For now, always return true
  return true;
}

// Endpoint to check NIN
router.post("/check-nin", async (req, res) => {
  try {
    const { number, username } = req.body;

    if (!number || !username) {
      return res.status(400).json({ success: false, message: "NIN number and user name are required" });
    }

    const result = checkNIN(number);
    res.json({ success: true, message: "NIN check completed", data: { result } });
  } catch (error) {
    console.error("Check NIN Error:", error);
    res.status(500).json({ success: false, message: "Failed to check NIN" });
  }
});

// Endpoint to verify CAC
router.post("/verify-cac", async (req, res) => {
  try {
    const { number, businessname } = req.body;

    if (!number || !businessname) {
      return res.status(400).json({ success: false, message: "CAC number and business name are required" });
    }

    const result = verifyCAC(number);
    res.json({ success:true, message: "CAC verification completed", data: { result } });
  } catch (error) {
    console.error("Verify CAC Error:", error);
    res.status(500).json({ success:false, message: "Failed to verify CAC" });
  }
});

export default router;
