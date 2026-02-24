// Test MCP server connection with session management
const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsImtpZCI6ImRaY2kyRW55OVA1WFhZZkUiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2RhcHFjbmxiaWxjcHd3bHdpdnZqLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIzYjRhZTZlNy01MjlhLTQ1MTItYTZmYy0yMmEzNWQwNjhjNmYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcxOTc2MTg3LCJpYXQiOjE3NzE5NzI1ODcsImVtYWlsIjoiYy5hbml2ZWxsQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjLmFuaXZlbGxAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcnN0X25hbWUiOiJQYXRyaWNrIiwibGFzdF9uYW1lIjoiQ2FuaXZlbGwiLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInN1YiI6IjNiNGFlNmU3LTUyOWEtNDUxMi1hNmZjLTIyYTM1ZDA2OGM2ZiJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzcxOTcyNTg3fV0sInNlc3Npb25faWQiOiIyY2Y4OTUwMy01NTI4LTQyYWMtYWQ2Zi01YzUwZmY5NDYxOWYiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.GNEjfd7LiZGMU_Nxy_2hGb34VC-jo40DLwO_SV1UGkY';

let sessionId = null;

function makeRequest(data, description) {
  return new Promise((resolve, reject) => {
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

    // Add session ID if we have one
    if (sessionId) {
      options.headers['mcp-session-id'] = sessionId;
    }

    console.log(`\n=== ${description} ===\n`);
    console.log('Request:', JSON.stringify(data, null, 2));
    if (sessionId) {
      console.log('Using Session ID:', sessionId);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        
        // Check for session ID in response headers
        const responseSessionId = res.headers['mcp-session-id'];
        if (responseSessionId) {
          console.log('Got Session ID from response:', responseSessionId);
          sessionId = responseSessionId;
        }
        
        console.log('Response Headers:', JSON.stringify(res.headers, null, 2));
        try {
          const parsed = JSON.parse(body);
          console.log('Response Body:', JSON.stringify(parsed, null, 2));
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

async function runTests() {
  try {
    // First initialize
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      },
      id: 1
    });
    await makeRequest(initRequest, 'Initialize Request');
    
    // Then list tools (should use session from initialize)
    const toolsListRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: 2
    });
    await makeRequest(toolsListRequest, 'Tools List Request (with session)');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTests();
