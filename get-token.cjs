// Script to get a Supabase JWT token
const https = require('https');

const data = JSON.stringify({
  email: 'c.anivell@gmail.com',
  password: 'AtomicCRM2024!'
});

const options = {
  hostname: 'dapqcnlbilcpwwlwivvj.supabase.co',
  port: 443,
  path: '/auth/v1/token?grant_type=password',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcHFjbmxiaWxjcHd3bHdpdnZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDg5ODM0OSwiZXhwIjoyMDcwNDc0MzQ5fQ.xw3OMiLidysqeQogmor_VJxy-8w9GBAboF-0Wquf4xI',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      if (result.access_token) {
        console.log('\n=== BEARER TOKEN (JWT) ===\n');
        console.log(result.access_token);
        console.log('\n=== REFRESH TOKEN ===\n');
        console.log(result.refresh_token);
        console.log('\n=== TOKEN INFO ===\n');
        console.log('Expires in:', result.expires_in, 'seconds');
        console.log('Token type:', result.token_type);
        console.log('\n=== FULL RESPONSE ===\n');
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Error:', body);
      }
    } catch (e) {
      console.log('Parse error:', e.message);
      console.log('Response:', body);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(data);
req.end();
