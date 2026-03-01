// Check all table columns
const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcHFjbmxiaWxjcHd3bHdpdnZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDg5ODM0OSwiZXhwIjoyMDcwNDc0MzQ5fQ.xw3OMiLidysqeQogmor_VJxy-8w9GBAboF-0Wquf4xI';

const tables = ['deals', 'tasks', 'companies', 'contactNotes', 'dealNotes'];

function checkTable(tableName) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dapqcnlbilcpwwlwivvj.supabase.co',
      port: 443,
      path: `/rest/v1/${tableName}?select=*&limit=1`,
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
        console.log(`\n=== ${tableName.toUpperCase()} ===`);
        console.log('Status:', res.statusCode);
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('Columns:', Object.keys(parsed[0]));
            console.log('Sample:', JSON.stringify(parsed[0], null, 2));
          } else if (Array.isArray(parsed) && parsed.length === 0) {
            console.log('Empty table - no sample data');
            // Try to get columns from error or empty response
          } else {
            console.log('Response:', body.substring(0, 500));
          }
          resolve(parsed);
        } catch (e) {
          console.log('Raw Response:', body.substring(0, 500));
          resolve(body);
        }
      });
    });

    req.on('error', (e) => {
      console.error(`Error for ${tableName}:`, e.message);
      reject(e);
    });

    req.end();
  });
}

async function checkAllTables() {
  for (const table of tables) {
    await checkTable(table);
  }
}

checkAllTables();
