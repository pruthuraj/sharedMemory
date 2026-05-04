// CLI smoke-test agent: connects to the server, registers an ID, sets a key, and subscribes.

const WebSocket = require('ws');

if (process.argv.length < 3) {
    console.log('Usage: node example_agent.js <agentId>');
    process.exit(1);
}

const agentId = process.argv[2];
const url = process.env.MCP_URL || 'ws://localhost:3000';
const ws = new WebSocket(url);

ws.on('open', () => {
    console.log('connected to', url);
    ws.send(JSON.stringify({ type: 'register', agentId }));
    // Example: set a key
    setTimeout(() => {
        ws.send(JSON.stringify({ type: 'set', key: 'greeting', value: `hello from ${agentId}` }));
    }, 500);

    // Subscribe to key updates
    ws.send(JSON.stringify({ type: 'subscribe', key: 'greeting' }));

    // After 2s, list known agents and memory
    setTimeout(() => ws.send(JSON.stringify({ type: 'list' })), 2000);
});

ws.on('message', (msg) => {
    try {
        const data = JSON.parse(msg);
        console.log('<<', data);
    } catch (e) { console.log('<<', msg.toString()); }
});

ws.on('close', () => console.log('connection closed'));
