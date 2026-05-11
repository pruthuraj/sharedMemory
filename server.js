// Entry point for npm start.

const { createSharedMemoryServer } = require('./src/server');

if (require.main === module) {
    const configuredPort = process.env.SHARED_MEMORY_PORT || process.env.PORT || '3001';
    const PORT = Number(configuredPort);
    if (!Number.isInteger(PORT) || PORT <= 0) {
        throw new Error(`Invalid port: ${configuredPort}`);
    }
    const appServer = createSharedMemoryServer({ port: PORT, entrypoint: __filename });
    let shuttingDown = false;

    appServer.listen(PORT, () => {
        console.log(`MCP shared memory server listening on http://localhost:${PORT}`);
    });

    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;

        const exitCode = signal === 'SIGINT' ? 130 : 143;
        try {
            appServer.memory.flushSync();
        } catch (error) {
            console.error(`Failed to flush memory during ${signal}: ${error.message}`);
        }

        Promise.resolve(appServer.close())
            .catch((error) => {
                console.error(`Failed to close server during ${signal}: ${error.message}`);
            })
            .finally(() => {
                process.exit(exitCode);
            });

        setTimeout(() => {
            process.exit(exitCode);
        }, 1000).unref();
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
    createSharedMemoryServer,
};
