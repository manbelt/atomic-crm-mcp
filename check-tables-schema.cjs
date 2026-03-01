// Check tasks and companies table schema via PostgREST API
const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcHFjbmxiaWxjcHd3bHdpdnZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDg5ODM0OSwiZXhwIjoyMDcwNDc0MzQ5fQ.xw3OMiLidysqeQogmor_VJxy-8w9GBAboF-0Wquf4xI';

// Use the OpenAPI endpoint to get table schema
function getTableSchema() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dapqcnlbilcpwwlwivvj.supabase.co',
      port: 443,
      path: '/rest/v1/?apikey=' + SERVICE_KEY,
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
          // Look for tasks and companies definitions
          if (parsed.definitions) {
            console.log('\n=== TASKS TABLE SCHEMA ===');
            if (parsed.definitions.tasks) {
              console.log('Properties:', Object.keys(parsed.definitions.tasks.properties || {}));
              console.log('Full schema:', JSON.stringify(parsed.definitions.tasks, null, 2));
            } else {
              console.log('Tasks table not found in definitions');
            }
            
            console.log('\n=== COMPANIES TABLE SCHEMA ===');
            if (parsed.definitions.companies) {
              console.log('Properties:', Object.keys(parsed.definitions.companies.properties || {}));
              console.log('Full schema:', JSON.stringify(parsed.definitions.companies, null, 2));
            } else {
              console.log('Companies table not found in definitions');
            }
          } else {
            console.log('No definitions found. Keys:', Object.keys(parsed));
          }
          resolve(parsed);
        } catch (e) {
          console.log('Raw Response:', body.substring(0, 2000));
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

getTableSchema();
