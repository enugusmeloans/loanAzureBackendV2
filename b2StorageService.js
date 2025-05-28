import B2 from 'backblaze-b2';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

dotenv.config();
// console.log("B2 is: " ,B2)
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});
const bucketId = process.env.B2_BUCKET_ID;

async function authorizeB2() {
  if (!b2.authorizationToken) {
    await b2.authorize();
  }
}

// Upload a file to Backblaze B2
async function uploadFile(file) {
  await authorizeB2();
  const fileName = Date.now() + '-' + file.originalname;
  const uploadUrlResponse = await b2.getUploadUrl({ bucketId });
  await b2.uploadFile({
    uploadUrl: uploadUrlResponse.data.uploadUrl,
    uploadAuthToken: uploadUrlResponse.data.authorizationToken,
    fileName,
    data: file.buffer,
    mime: file.mimetype,
  });
  // For private buckets, return the fileName (not a public URL)
  return fileName;
}

// List all files in the bucket (returns file names)
async function listFiles() {
  await authorizeB2();
  const response = await b2.listFileNames({ bucketId });
  return response.data.files.map(file => file.fileName);
}

// Delete a file from Backblaze B2
async function deleteFile(fileName) {
  await authorizeB2();
  // Find fileId
  const response = await b2.listFileNames({ bucketId, prefix: fileName });
  const file = response.data.files.find(f => f.fileName === fileName);
  if (file) {
    await b2.deleteFileVersion({ fileName, fileId: file.fileId });
  }
}

// Download a file from Backblaze B2
/**
 * Download a file from Backblaze B2.
 * @param {string} fileOrUrl - File name (in B2) or a full signed URL.
 * @returns {Promise<ReadableStream>} - Readable stream of the file contents.
 */
async function downloadFile(fileOrUrl) {
  // If it's a full URL, use it directly; otherwise, construct the URL
  let url = fileOrUrl;
  if (!/^https?:\/\//i.test(fileOrUrl)) {
    // If not a URL, get a signed URL for the file
    url = await getSignedUrl(fileOrUrl);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.statusText}`);
  return res.body; // This is a readable stream
}

// Generate a signed download URL for a private file
async function getSignedUrl(fileName, validDurationSeconds = 3600) {
  await authorizeB2();
  // Get bucket name from B2 API
  // const bucketInfo = await b2.getBucket({ bucketId });
  const bucketName =process.env.B2_BUCKET_NAME;
  // Get download authorization token
  const response = await b2.getDownloadAuthorization({
    bucketId,
    fileNamePrefix: fileName,
    validDurationInSeconds: validDurationSeconds,
  });
  // Construct the correct download URL
  const baseUrl = `https://f003.backblazeb2.com/file/${bucketName}`;
  return `${baseUrl}/${fileName}?Authorization=${response.data.authorizationToken}`;
}

export { uploadFile, listFiles, deleteFile, downloadFile, getSignedUrl };
