// const url = 'https://api.qoreid.com/token';
// const options = {
//   method: 'POST',
//   headers: {accept: 'text/plain', 'content-type': 'application/json'},
//   body: JSON.stringify({clientId: 'VNK643HLSCNEYKZW71DH', secret: '7825905bf8c1489281f2b7888159f77b'})
// };

// fetch(url, options)
//   .then(res => res.json())
//   .then(json => console.log(json))
//   .catch(err => console.error(err));

// console.log("Have a nice day!");

// test blaze connection
// import { listFiles } from './b2StorageService.js';

// console.log('B2_KEY_ID:', process.env.B2_KEY_ID);
// console.log('B2_APP_KEY:', process.env.B2_APP_KEY);

// (async () => {
//   try {
//     const files = await listFiles();
//     console.log('✅ Files in bucket:', files);
//   } catch (err) {
//     console.error('❌ Error communicating with B2:', err.message);
//   }
// })();


async function testUploadFromDisk(filePath) {
  await authorizeB2();
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const uploadUrlResponse = await b2.getUploadUrl({ bucketId });

  await b2.uploadFile({
    uploadUrl: uploadUrlResponse.data.uploadUrl,
    uploadAuthToken: uploadUrlResponse.data.authorizationToken,
    fileName,
    data: buffer,
    mime: 'application/octet-stream', // or set dynamically
  });

  console.log(`✅ Uploaded: ${fileName}`);
}
