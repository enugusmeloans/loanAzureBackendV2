import B2 from 'backblaze-b2';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();
console.log("B2 is: " ,B2)
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
async function downloadFile(fileName, destination) {
  await authorizeB2();
  const url = `${process.env.B2_PUBLIC_URL}/${fileName}`;
  const res = await fetch(url);
  const fileStream = fs.createWriteStream(destination);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });
}

// Generate a signed download URL for a private file
async function getSignedUrl(fileName, validDurationSeconds = 3600) {
  await authorizeB2();
  const response = await b2.getDownloadAuthorization({
    bucketId,
    fileNamePrefix: fileName,
    validDurationInSeconds: validDurationSeconds,
  });
  // The download URL for private files
  const baseUrl = `${process.env.B2_PUBLIC_URL}`;
  return `${baseUrl}/${fileName}?Authorization=${response.data.authorizationToken}`;
}

export { uploadFile, listFiles, deleteFile, downloadFile, getSignedUrl };
