const COMMAND_TYPES = new Set([
    'register',
    'set',
    'get',
    'subscribe',
    'unsubscribe',
    'link',
    'unlink',
    'list',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function parseMessage(raw) {
    let message;

    try {
        const text = typeof raw === 'string' ? raw : raw.toString();
        message = JSON.parse(text);
    } catch (error) {
        return { ok: false, error: 'invalid-json' };
    }

    if (!isPlainObject(message)) {
        return { ok: false, error: 'invalid-message' };
    }

    if (!isNonEmptyString(message.type) || !COMMAND_TYPES.has(message.type)) {
        return { ok: false, error: 'unknown-type' };
    }

    return validateMessage(message);
}

function validateMessage(message) {
    switch (message.type) {
        case 'register':
            if (Object.prototype.hasOwnProperty.call(message, 'agentId') && !isNonEmptyString(message.agentId)) {
                return { ok: false, error: 'missing-agentId' };
            }
            return { ok: true, message };

        case 'set':
        case 'get':
        case 'subscribe':
        case 'unsubscribe':
            if (!isNonEmptyString(message.key)) {
                return { ok: false, error: 'missing-key' };
            }
            return { ok: true, message };

        case 'link':
        case 'unlink':
            if (!isNonEmptyString(message.target)) {
                return { ok: false, error: 'missing-target' };
            }
            return { ok: true, message };

        case 'list':
            return { ok: true, message };

        default:
            return { ok: false, error: 'unknown-type' };
    }
}

module.exports = {
    parseMessage,
};
