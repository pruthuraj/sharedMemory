#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');

const { DIRECT_RESPONSE_TYPES } = require('../src/protocol');

const DEFAULT_PORT = 3001;

function defaultPort() {
    return process.env.SHARED_MEMORY_PORT || process.env.PORT || DEFAULT_PORT;
}

function defaultWsUrl() {
    return process.env.MCP_URL
        || process.env.SHARED_MEMORY_WS_URL
        || process.env.SMOKE_WS_URL
        || `ws://127.0.0.1:${defaultPort()}`;
}

function httpUrlFromWsUrl(wsUrl) {
    return wsUrl.replace(/^ws/, 'http');
}

function createRequestId(type) {
    return `${type || 'request'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

class SharedMemoryWsClient {
    constructor(options = {}) {
        this.wsUrl = options.wsUrl || defaultWsUrl();
        this.httpUrl = options.httpUrl || httpUrlFromWsUrl(this.wsUrl);
        this.token = options.token ?? process.env.MEMORY_TOKEN ?? '';
        this.timeoutMs = options.timeoutMs || 30000;
        this.responseTypes = options.responseTypes || DIRECT_RESPONSE_TYPES;
        this.ws = null;
        this.messages = [];
        this.pending = new Map();
        this.waiters = [];
    }

    async connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return this;

        this.ws = new WebSocket(this.wsUrl);
        this.ws.on('message', (raw) => this.handleMessage(raw));
        this.ws.on('close', () => this.rejectAll(new Error('WebSocket closed')));
        this.ws.on('error', (error) => this.rejectAll(error));

        await new Promise((resolve, reject) => {
            this.ws.once('open', resolve);
            this.ws.once('error', reject);
        });

        return this;
    }

    handleMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        this.messages.push(message);

        for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
            const waiter = this.waiters[index];
            if (waiter.predicate(message)) {
                clearTimeout(waiter.timeout);
                this.waiters.splice(index, 1);
                waiter.resolve(message);
            }
        }

        if (message.requestId == null || !this.pending.has(message.requestId)) return;

        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        clearTimeout(pending.timeout);

        if (
            pending.expectedType
            && message.type !== pending.expectedType
            && message.type !== 'error'
        ) {
            const error = new Error(`Expected ${pending.expectedType} for ${pending.commandType}, got ${message.type}`);
            error.response = message;
            pending.reject(error);
            return;
        }

        if (message.type === 'error' && pending.rejectOnError) {
            const error = new Error(`${pending.commandType} failed: ${message.message}`);
            error.response = message;
            pending.reject(error);
            return;
        }

        pending.resolve(message);
    }

    rejectAll(error) {
        for (const waiter of this.waiters.splice(0)) {
            clearTimeout(waiter.timeout);
            waiter.reject(error);
        }

        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }

    waitFor(predicate, timeoutMs = this.timeoutMs) {
        const existing = this.messages.find(predicate);
        if (existing) return Promise.resolve(existing);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for WebSocket message'));
            }, timeoutMs);
            this.waiters.push({ predicate, resolve, reject, timeout });
        });
    }

    request(payload, options = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('WebSocket is not open'));
        }

        const requestId = payload.requestId ?? createRequestId(payload.type);
        const expectedType = options.expectedType ?? this.responseTypes[payload.type];
        const timeoutMs = options.timeoutMs ?? this.timeoutMs;
        const rejectOnError = options.rejectOnError !== false;
        const message = { ...payload, requestId };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Timed out waiting for ${payload.type} response`));
            }, timeoutMs);

            this.pending.set(requestId, {
                commandType: payload.type,
                expectedType,
                rejectOnError,
                resolve,
                reject,
                timeout,
            });

            this.ws.send(JSON.stringify(message));
        });
    }

    async authenticate(token = this.token) {
        if (!token) return null;
        return this.request({ type: 'auth', token });
    }

    register(agentId) {
        return this.request({ type: 'register', agentId });
    }

    close() {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();

        return new Promise((resolve) => {
            this.ws.once('close', resolve);
            this.ws.close();
        });
    }
}

async function fetchProtocol(options = {}) {
    const wsUrl = options.wsUrl || defaultWsUrl();
    const httpUrl = options.httpUrl || httpUrlFromWsUrl(wsUrl);
    const token = options.token ?? process.env.MEMORY_TOKEN ?? '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${httpUrl}/protocol`, { headers });
    if (!response.ok) {
        throw new Error(`/protocol returned HTTP ${response.status}`);
    }
    return response.json();
}

module.exports = {
    SharedMemoryWsClient,
    fetchProtocol,
    defaultPort,
    defaultWsUrl,
    httpUrlFromWsUrl,
};
