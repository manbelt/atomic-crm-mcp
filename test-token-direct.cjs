// Test token directly against Supabase
const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsImtpZCI6ImRaY2kyRW55OVA1WFhZZkUiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2RhcHFjbmxiaWxjcHd3bHdpdnZqLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIzYjRhZTZlNy01MjlhLTQ1MTItYTZmYy0yMmEzNWQwNjhjNmYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcxOTc2MTg3LCJpYXQiOjE3NzE5NzI1ODcsImVtYWlsIjoiYy5hbml2ZWxsQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjLmFuaXZlbGxAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcnN0X25hbWUiOiJQYXRyaWNrIiwibGFzdF9uYW1lIjoiQ2FuaXZlbGwiLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInN1YiI6IjNiNGFlNmU3LTUyOWEtNDUxMi1hNmZjLTIyYTM1ZDA2OGM2ZiJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzcxOTcyNTg3fV0sInNlc3Npb25faWQiOiIyY2Y4OTUwMy01NTI4LTQyYWMtYWQ2Zi01YzUwZmY5NDYxOWYiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.GNEjfd7LiZGMU_Nxy_2hGb34VC-jo40DLwO_SV1UGkY';

const SUPABASE_URL = 'dapqcnlbilcpwwlwivvj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcHFjbmxiaWxjcHd3bHdpdnZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDg5ODM0OSwiZXhwIjoyMDcwNDc0MzQ5fQ.xw3OMiLidysqeQogmor_VJxy-8w9GBAboF-0Wquf4xI';

function testToken() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_URL,
      port: 443,
      path: '/auth/v1/user',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'apikey': SUPABASE_ANON_KEY,
      }
    };

    console.log('Testing token against Supabase...');
    console.log('URL:', `https://${SUPABASE_URL}/auth/v1/user`);

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        try {
          const parsed = JSON.parse(body);
          console.log('Response:', JSON.stringify(parsed, null, 2));
          resolve(parsed);
        } catch (e) {
          console.log('Raw Response:', body);
          resolve(body);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Error:', e.message);
      reject(e);
    });

    req.end();
  });
}

testToken();
