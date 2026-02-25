// Test MCP tool call to see actual error
const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsImtpZCI6ImRaY2kyRW55OVA1WFhZZkUiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2RhcHFjbmxiaWxjcHd3bHdpdnZqLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIzYjRhZTZlNy01MjlhLTQ1MTItYTZmYy0yMmEzNWQwNjhjNmYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcxOTgzMDE0LCJpYXQiOjE3NzE5Nzk0MTQsImVtYWlsIjoiYy5hbml2ZWxsQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjLmFuaXZlbGxAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcnN0X25hbWUiOiJQYXRyaWNrIiwibGFzdF9uYW1lIjoiQ2FuaXZlbGwiLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInN1YiI6IjNiNGFlNmU3LTUyOWEtNDUxMi1hNmZjLTIyYTM1ZDA2OGM2ZiJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzcxOTc5NDE0fV0sInNlc3Npb25faWQiOiIzYWY4NzNjOC02MDU1LTRmM2ItYmFhOS04OWYzMDliNmVmMjAiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.0kOj5hEkkqDi3AFMhCGUyw_Hau-kr9f90Acq93BDtAk';

function testToolCall() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_summary',
        arguments: {}
      },
      id: 3
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

    console.log('=== Testing get_summary tool ===\n');

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

testToolCall();
