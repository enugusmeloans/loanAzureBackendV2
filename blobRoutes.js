import express from "express";
import multer from "multer";
import { uploadImage, listImages, deleteImage, generateSasUrl } from "./azureBlobService.js";
import sql from "mssql"; // Import SQL for database operations

const router = express.Router();
const storage = multer.memoryStorage(); // Configure multer to store files in memory
const upload = multer({ storage }); // Initialize multer with the memory storage

// Authentication middleware
function isAuthenticated(req, res, next) {
    console.log('Session:', req.session);
    console.log('User:', req.user);
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: "Unauthorized" });
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

// Route to upload a single image
router.post("/upload", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" }); // Validate file existence
        const imageUrl = await uploadImage(req.file); // Upload the image
        res.json({ message: "Upload successful", imageUrl }); // Respond with the image URL
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

// Route to upload multiple images - up to 10
router.post("/upload-multiple", upload.array("images", 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No files uploaded" }); // Validate files

        const imageUrls = [];
        for (const file of req.files) {
            const imageUrl = await uploadImage(file); // Upload each image
            imageUrls.push(imageUrl);
        }
        res.json({ message: "Upload successful", imageUrls }); // Respond with the list of image URLs
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

// Route to fetch all images
router.get("/images", async (req, res) => {
    try {
        const images = await listImages(); // Fetch all images
        res.json({ images }); // Respond with the list of image URLs
    } catch (error) {
        console.error("Fetch Error:", error);
        res.status(500).json({ error: "Could not fetch images" });
    }
});

// Route to fetch a single image with a SAS token
router.get("/image/:blobName", async (req, res) => {
    try {
        const blobName = req.params.blobName; // Get the blob name from the route parameter
        const now = new Date();
        const expiry = new Date(now);
        expiry.setHours(now.getHours() + 1); // Set SAS token validity to 1 hour

        const blobClient = containerClient.getBlobClient(blobName); // Get a client for the blob
        const sasToken = generateBlobSASQueryParameters(
            {
                containerName: process.env.AZURE_CONTAINER_NAME,
                blobName,
                permissions: BlobSASPermissions.parse("r"), // Grant read permissions
                startsOn: now,
                expiresOn: expiry,
            },
            blobServiceClient.credential
        ).toString();

        const imageUrl = `${blobClient.url}?${sasToken}`; // Append the SAS token to the blob URL
        res.json({ imageUrl }); // Respond with the image URL
    } catch (error) {
        console.error("Fetch Error:", error);
        res.status(500).json({ error: "Could not fetch image" });
    }
});

// Route to delete a single image
router.delete("/delete/:blobName", async (req, res) => {
    try {
        const blobName = req.params.blobName; // Get the blob name from the route parameter
        await deleteImage(blobName); // Delete the image
        res.json({ message: "Image deleted successfully" }); // Respond with success message
    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ error: "Delete failed" });
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
            await deleteImage(blobName); // Delete each image
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
        if (!applicationId) return res.status(400).json({ error: "Application ID is required" });
        if (!CAC) return res.status(400).json({ error: "CAC is required" });
        if (!req.files || !req.files.idCard || !req.files.businessCertificate) {
            return res.status(400).json({ error: "All document images are required" });
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
            return res.status(404).json({ error: "Application not found" });
        }

        const { loanStatus } = applicationResult.recordset[0];
        if (loanStatus !== "Accepted1") {
            poolConnection.close();
            return res.status(400).json({ error: "Application is ineligible for document upload" });
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
            if (previousImages.IdCardLink) await deleteImage(previousImages.IdCardLink.split("/").pop());
            if (previousImages.businessCertificateLink) await deleteImage(previousImages.businessCertificateLink.split("/").pop());

            // Update the existing record with new image URLs and CAC
            const idCardUrl = await uploadImage(req.files.idCard[0]);
            const businessCertificateUrl = await uploadImage(req.files.businessCertificate[0]);

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

            // Generate SAS tokens for the new images
            const idCardSasUrl = await generateSasUrl(idCardUrl);
            const businessCertificateSasUrl = await generateSasUrl(businessCertificateUrl);

            // Update loanStatus to "Pending"
            await poolConnection.request()
                .input("applicationId", sql.Int, applicationId)
                .input("loanStatus", sql.VarChar, "Pending")
                .query(`
                    UPDATE dbo.Applications
                    SET loanStatus = @loanStatus
                    WHERE applicationId = @applicationId
                `);

            res.json({
                message: "Documents updated successfully",
                urls: {
                    idCardUrl: idCardSasUrl,
                    businessCertificateUrl: businessCertificateSasUrl
                }
            });
        } else {
            // Insert new record if the application does not exist
            const idCardUrl = await uploadImage(req.files.idCard[0]);
            const businessCertificateUrl = await uploadImage(req.files.businessCertificate[0]);

            await poolConnection.request()
                .input("applicationId", sql.Int, applicationId)
                .input("idCardLink", sql.VarChar, idCardUrl)
                .input("businessCertificateLink", sql.VarChar, businessCertificateUrl)
                .input("CAC", sql.VarChar, CAC)
                .query(`
                    INSERT INTO dbo.UploadDocuments (applicationId, IdCardLink, businessCertificateLink, CAC)
                    VALUES (@applicationId, @idCardLink, @businessCertificateLink, @CAC)
                `);

            // Generate SAS tokens for the new images
            const idCardSasUrl = await generateSasUrl(idCardUrl);
            const businessCertificateSasUrl = await generateSasUrl(businessCertificateUrl);

            // Update loanStatus to "Pending"
            await poolConnection.request()
                .input("applicationId", sql.Int, applicationId)
                .input("loanStatus", sql.VarChar, "Pending")
                .query(`
                    UPDATE dbo.Applications
                    SET loanStatus = @loanStatus
                    WHERE applicationId = @applicationId
                `);

            res.json({
                message: "Documents uploaded and stored successfully",
                urls: {
                    idCardUrl: idCardSasUrl,
                    businessCertificateUrl: businessCertificateSasUrl
                }
            });
        }

        poolConnection.close();
    } catch (error) {
        console.error("Upload Documents Error:", error);
        res.status(500).json({ error: "Failed to upload and store documents" });
    }
});

// Route to get the images (documents) of an application
router.get("/application-images/:applicationId", async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Validate applicationId
        if (!applicationId) return res.status(400).json({ error: "Application ID is required" });

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
            return res.status(404).json({ error: "No images found for the given application ID" });
        }

        const { IdCardLink, businessCertificateLink } = result.recordset[0];

        // Generate SAS tokens for the image URLs
        const idCardSasUrl = IdCardLink ? await generateSasUrl(IdCardLink) : null;
        const businessCertificateSasUrl = businessCertificateLink ? await generateSasUrl(businessCertificateLink) : null;

        res.json({
            message: "Application images retrieved successfully",
            urls: {
                idCardUrl: idCardSasUrl,
                businessCertificateUrl: businessCertificateSasUrl
            }
        });
    } catch (error) {
        console.error("Fetch Application Images Error:", error);
        res.status(500).json({ error: "Failed to fetch application images" });
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
        const { number } = req.body;

        if (!number) {
            return res.status(400).json({ error: "NIN number is required" });
        }

        const result = checkNIN(number);
        res.json({ message: "NIN check completed", result });
    } catch (error) {
        console.error("Check NIN Error:", error);
        res.status(500).json({ error: "Failed to check NIN" });
    }
});

// Endpoint to verify CAC
router.post("/verify-cac", async (req, res) => {
    try {
        const { number } = req.body;

        if (!number) {
            return res.status(400).json({ error: "CAC number is required" });
        }

        const result = verifyCAC(number);
        res.json({ message: "CAC verification completed", result });
    } catch (error) {
        console.error("Verify CAC Error:", error);
        res.status(500).json({ error: "Failed to verify CAC" });
    }
});

export default router;
