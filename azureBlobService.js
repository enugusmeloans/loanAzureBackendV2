import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env file

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_CONTAINER_NAME);

// Ensure the container exists; create it if it doesn't
async function ensureContainerExists() {
    const exists = await containerClient.exists(); // Check if the container exists
    if (!exists) {
        await containerClient.create(); // Create the container if it doesn't exist
        console.log(`Container '${process.env.AZURE_CONTAINER_NAME}' created`);
    }
}

// Upload a single image to Azure Blob Storage
async function uploadImage(file) {
    const blobName = Date.now() + "-" + file.originalname; // Generate a unique blob name
    const blockBlobClient = containerClient.getBlockBlobClient(blobName); // Get a client for the blob
    await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype }, // Set the content type of the blob
    });
    return blockBlobClient.url; // Return the URL of the uploaded blob
}

// List all images in the container with SAS tokens for secure access
async function listImages() {
    const now = new Date();
    const expiry = new Date(now);
    expiry.setHours(now.getHours() + 1); // Set SAS token validity to 1 hour

    let imageUrls = [];
    for await (const blob of containerClient.listBlobsFlat()) {
        const blobClient = containerClient.getBlobClient(blob.name); // Get a client for the blob
        const sasToken = generateBlobSASQueryParameters(
            {
                containerName: process.env.AZURE_CONTAINER_NAME,
                blobName: blob.name,
                permissions: BlobSASPermissions.parse("r"), // Grant read permissions
                startsOn: now,
                expiresOn: expiry,
            },
            blobServiceClient.credential
        ).toString();
        imageUrls.push(`${blobClient.url}?${sasToken}`); // Append the SAS token to the blob URL
    }
    return imageUrls; // Return the list of image URLs
}

// Delete a single image from Azure Blob Storage
async function deleteImage(blobName) {
    const decodedBlobName = decodeURIComponent(blobName); // Decode the blob name
    const blockBlobClient = containerClient.getBlockBlobClient(decodedBlobName); // Get a client for the blob

    const exists = await blockBlobClient.exists(); // Check if the blob exists
    if (!exists) {
        console.warn(`Blob '${decodedBlobName}' does not exist. Skipping deletion.`);
        return; // Skip deletion if the blob does not exist
    }

    await blockBlobClient.delete(); // Delete the blob
    console.log(`Blob '${decodedBlobName}' deleted successfully.`);
}

// Generate a SAS token for a given blob URL
async function generateSasUrl(blobUrl) {
    const blobName = blobUrl.split("/").pop(); // Extract blob name from the URL
    const now = new Date();
    const expiry = new Date(now);
    expiry.setHours(now.getHours() + 1); // Set SAS token validity to 1 hour

    const blobClient = containerClient.getBlobClient(blobName);
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

    return `${blobClient.url}?${sasToken}`; // Return the URL with the SAS token
}

export { ensureContainerExists, uploadImage, listImages, deleteImage, generateSasUrl };
