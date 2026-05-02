const { createSharedMemoryServer } = require('./src/server');

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    const appServer = createSharedMemoryServer();

    appServer.listen(PORT, () => {
        console.log(`MCP shared memory server listening on http://localhost:${PORT}`);
    });
}

module.exports = {
    createSharedMemoryServer,
};
