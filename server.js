const { createSharedMemoryServer } = require('./src/server');

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    const appServer = createSharedMemoryServer();
    let shuttingDown = false;

    appServer.listen(PORT, () => {
        console.log(`MCP shared memory server listening on http://localhost:${PORT}`);
    });

    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;

        appServer.memory.flushSync();
        appServer.server.close(() => {
            process.exit(signal === 'SIGINT' ? 130 : 143);
        });

        setTimeout(() => {
            process.exit(signal === 'SIGINT' ? 130 : 143);
        }, 1000).unref();
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
    createSharedMemoryServer,
};
