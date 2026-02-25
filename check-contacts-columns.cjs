// Check contacts table columns
const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcHFjbmxiaWxjcHd3bHdpdnZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDg5ODM0OSwiZXhwIjoyMDcwNDc0MzQ5fQ.xw3OMiLidysqeQogmor_VJxy-8w9GBAboF-0Wquf4xI';

function checkColumns() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dapqcnlbilcpwwlwivvj.supabase.co',
      port: 443,
      path: '/rest/v1/contacts?select=*&limit=1',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('Columns:', Object.keys(parsed[0]));
            console.log('Sample row:', JSON.stringify(parsed[0], null, 2));
          } else {
            console.log('No data or empty array:', body);
          }
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

checkColumns();
