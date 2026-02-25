// Test MCP create_contact tool
const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsImtpZCI6ImRaY2kyRW55OVA1WFhZZkUiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2RhcHFjbmxiaWxjcHd3bHdpdnZqLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIzYjRhZTZlNy01MjlhLTQ1MTItYTZmYy0yMmEzNWQwNjhjNmYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcxOTg0NzAxLCJpYXQiOjE3NzE5ODExMDEsImVtYWlsIjoiYy5hbml2ZWxsQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjLmFuaXZlbGxAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcnN0X25hbWUiOiJQYXRyaWNrIiwibGFzdF9uYW1lIjoiQ2FuaXZlbGwiLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInN1YiI6IjNiNGFlNmU3LTUyOWEtNDUxMi1hNmZjLTIyYTM1ZDA2OGM2ZiJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzcxOTgxMTAxfV0sInNlc3Npb25faWQiOiJhZGZlNDQzMC0yM2JlLTQ1MzMtYjlhMy05YjEyMDc0MDY0ZjYiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.cWilpM5lXselsHVhZNQou2B-CYMi92k5y-bU8dycjxA';

function testCreateContact() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'create_contact',
        arguments: {
          first_name: 'Test',
          last_name: 'User',
          email: 'test.user@example.com'
        }
      },
      id: 1
    });
    
    const options = {
      hostname: 'atomic-crm-mcp.vercel.app',
      port: 443,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    console.log('=== Testing create_contact tool ===\n');

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

    req.write(data);
    req.end();
  });
}

testCreateContact();
