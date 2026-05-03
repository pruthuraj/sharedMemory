const COMMAND_TYPES = new Set([
    'auth',
    'register',
    'set',
    'get',
    'subscribe',
    'unsubscribe',
    'link',
    'unlink',
    'list',
    'relate',
    'unrelate',
    'delete',
    'map',
    'search',
]);

const RELATION_TYPES = new Set([
    'related_to',
    'depends_on',
    'supports',
    'contradicts',
    'mentions',
    'derived_from',
    'next_step',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function isIntegerInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function isNumberInRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isValidRequestId(value) {
    return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function hasValidTags(tags) {
    return Array.isArray(tags) && tags.every(isNonEmptyString);
}

function validateSetMetadata(message) {
    if (hasOwn(message, 'summary') && !isNonEmptyString(message.summary)) {
        return { ok: false, error: 'invalid-summary' };
    }

    if (hasOwn(message, 'tags') && !hasValidTags(message.tags)) {
        return { ok: false, error: 'invalid-tags' };
    }

    if (hasOwn(message, 'importance') && !isIntegerInRange(message.importance, 0, 10)) {
        return { ok: false, error: 'invalid-importance' };
    }

    return null;
}

function validateRelationFields(message) {
    if (!isNonEmptyString(message.from)) {
        return { ok: false, error: 'missing-from' };
    }

    if (!isNonEmptyString(message.to)) {
        return { ok: false, error: 'missing-to' };
    }

    if (!isNonEmptyString(message.relation) || !RELATION_TYPES.has(message.relation)) {
        return { ok: false, error: 'invalid-relation' };
    }

    return null;
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

    if (hasOwn(message, 'requestId') && !isValidRequestId(message.requestId)) {
        return { ok: false, error: 'invalid-requestId' };
    }

    const requestId = hasOwn(message, 'requestId') ? message.requestId : undefined;

    if (!isNonEmptyString(message.type) || !COMMAND_TYPES.has(message.type)) {
        return { ok: false, error: 'unknown-type', requestId };
    }

    const result = validateMessage(message);
    if (!result.ok) {
        return { ...result, requestId };
    }
    return result;
}

function validateMessage(message) {
    switch (message.type) {
        case 'auth':
            return { ok: true, message };

        case 'register':
            if (Object.prototype.hasOwnProperty.call(message, 'agentId') && !isNonEmptyString(message.agentId)) {
                return { ok: false, error: 'missing-agentId' };
            }
            return { ok: true, message };

        case 'set':
            if (!isNonEmptyString(message.key)) {
                return { ok: false, error: 'missing-key' };
            }
            return validateSetMetadata(message) || { ok: true, message };

        case 'get':
        case 'subscribe':
        case 'unsubscribe':
        case 'delete':
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

        case 'relate': {
            const relationError = validateRelationFields(message);
            if (relationError) return relationError;

            if (hasOwn(message, 'reason') && !isNonEmptyString(message.reason)) {
                return { ok: false, error: 'invalid-reason' };
            }

            if (hasOwn(message, 'weight') && !isNumberInRange(message.weight, 0, 1)) {
                return { ok: false, error: 'invalid-weight' };
            }

            return { ok: true, message };
        }

        case 'unrelate': {
            const relationError = validateRelationFields(message);
            return relationError || { ok: true, message };
        }

        case 'map':
            if (!isNonEmptyString(message.key)) {
                return { ok: false, error: 'missing-key' };
            }

            if (hasOwn(message, 'depth') && !isIntegerInRange(message.depth, 0, 10)) {
                return { ok: false, error: 'invalid-depth' };
            }

            if (hasOwn(message, 'limit') && !isIntegerInRange(message.limit, 1, 100)) {
                return { ok: false, error: 'invalid-limit' };
            }

            return { ok: true, message };

        case 'search': {
            if (hasOwn(message, 'query') && !isNonEmptyString(message.query)) {
                return { ok: false, error: 'invalid-query' };
            }

            if (hasOwn(message, 'tags') && !hasValidTags(message.tags)) {
                return { ok: false, error: 'invalid-tags' };
            }

            if (hasOwn(message, 'minImportance') && !isIntegerInRange(message.minImportance, 0, 10)) {
                return { ok: false, error: 'invalid-importance' };
            }

            if (hasOwn(message, 'limit') && !isIntegerInRange(message.limit, 1, 100)) {
                return { ok: false, error: 'invalid-limit' };
            }

            const hasQuery = hasOwn(message, 'query');
            const hasTags = hasOwn(message, 'tags') && message.tags.length > 0;
            const hasMinImportance = hasOwn(message, 'minImportance');
            if (!hasQuery && !hasTags && !hasMinImportance) {
                return { ok: false, error: 'missing-filter' };
            }

            return { ok: true, message };
        }

        default:
            return { ok: false, error: 'unknown-type' };
    }
}

module.exports = {
    parseMessage,
    RELATION_TYPES,
};
