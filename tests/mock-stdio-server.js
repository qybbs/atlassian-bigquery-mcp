#!/usr/bin/env node
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    if (message.jsonrpc !== '2.0') return;

    if (message.method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [
            {
              name: 'hello_world',
              description: 'A mock stdio tool',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        }
      };
      console.log(JSON.stringify(response));
    } else if (message.method === 'tools/call') {
      const toolName = message.params?.name;
      if (toolName === 'hello_world') {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [{ type: 'text', text: 'Hello from mock stdio server!' }]
          }
        };
        console.log(JSON.stringify(response));
      } else {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${toolName}` }
        };
        console.log(JSON.stringify(response));
      }
    }
  } catch (err) {
    // ignore invalid JSON
  }
});
