const { createHmac, timingSafeEqual } = require('node:crypto');
const { deleteAccountData, query } = require('../lib/account-cleanup');

function seal(payload, key) {
    const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return value + '.' + createHmac('sha256', key).update(value).digest('base64url');
}

function unseal(token, key) {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const value = token.split('.')[0];
    const expected = sealRaw(value, key);
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString());
    return payload.expires > Date.now() ? payload : null;
}

function sealRaw(value, key) {
    return Buffer.from(value + '.' + createHmac('sha256', key).update(value).digest('base64url'));
}

module.exports = async function selfServiceDeletion(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Use POST.' });
    }

    const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_DATABASE_ID: database,
        APPWRITE_SELF_DELETION_API_KEY: apiKey, ACCOUNT_DELETION_SECRET: secret,
        ACCOUNT_DELETION_BUCKET_IDS: bucketIds, ACCOUNT_DELETION_EXTRA_ROWS: extraRows } = process.env;

    const body = req.body ?? {};
    let operation = 'configuration';
    let step = 'environment variables';
    let missing = [];
    const deadline = Date.now() + 45000;
    try {
        missing = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_SELF_DELETION_API_KEY', 'ACCOUNT_DELETION_SECRET']
            .filter((name) => !process.env[name]?.trim());
        if (missing.length) throw new Error('Missing deletion configuration');
        step = 'ACCOUNT_DELETION_SECRET length';
        if (secret.trim().length < 32) throw new Error('Invalid deletion secret');

        async function request(method, path, options = {}) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('Deletion time budget exhausted');
            const headers = { 'X-Appwrite-Project': project, 'Content-Type': 'application/json' };
            if (!options.public) headers['X-Appwrite-Key'] = apiKey;
            if (options.session) headers['X-Appwrite-Session'] = options.session;
            const response = await fetch(endpoint.replace(/\/+$/, '') + path, {
                method, headers, body: JSON.stringify(options.body), redirect: 'error',
                signal: AbortSignal.timeout(Math.min(remaining, 8000))
            });
            if (options.missing && response.status === 404) return null;
            if (!response.ok) {
                const error = new Error('Appwrite request failed');
                error.status = response.status;
                throw error;
            }
            return response.status === 204 ? null : response.json();
        }

        operation = body.action;
        if (operation === 'send') {
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'Enter your SphereMessage account email.' });
            }
            const params = new URLSearchParams();
            params.append('queries[]', query('equal', 'email', [email]));
            step = 'Appwrite user lookup';
            const { users } = await request('GET', '/users?' + params);
            const user = users.find((entry) => entry.email?.toLowerCase() === email);
            if (user) {
                step = 'Appwrite Email OTP';
                const token = await request('POST', '/account/tokens/email', { public: true, body: { userId: user.$id, email } });
                if (token.userId !== user.$id) throw new Error('Unexpected Appwrite token identity');
            }
            return res.status(200).json({
                challenge: seal({ stage: 'code', userId: user?.$id, created: user?.$createdAt,
                    expires: Date.now() + 10 * 60000 }, secret)
            });
        }

        const proof = unseal(body.proof, secret);
        if (operation === 'verify') {
            if (proof?.stage !== 'code' || !proof.userId || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
                return res.status(400).json({ error: 'The code is invalid or expired.' });
            }
            let session;
            try {
                step = 'Appwrite code verification';
                session = await request('POST', '/account/sessions/token', {
                    public: true, body: { userId: proof.userId, secret: body.code }
                });
            } catch (error) {
                if ([400, 401, 404].includes(error.status)) {
                    return res.status(400).json({ error: 'The code is invalid or expired.' });
                }
                throw error;
            }
            if (session.userId !== proof.userId || !session.$id) throw new Error('Unexpected Appwrite session identity');
            step = 'Appwrite verification session removal';
            await request('DELETE', '/users/' + encodeURIComponent(proof.userId) + '/sessions/' + encodeURIComponent(session.$id), { missing: true });
            return res.status(200).json({ proof: seal({ ...proof, stage: 'delete', expires: Date.now() + 60 * 60000 }, secret) });
        }

        if (operation !== 'delete' || proof?.stage !== 'delete' || body.confirmed !== true) {
            return res.status(400).json({ error: 'Verify your email and confirm permanent deletion.' });
        }

        step = 'cleanup configuration';
        missing = ['APPWRITE_DATABASE_ID', 'ACCOUNT_DELETION_BUCKET_IDS', 'ACCOUNT_DELETION_EXTRA_ROWS']
            .filter((name) => !process.env[name]?.trim());
        if (missing.length) throw new Error('Missing cleanup configuration');
        const config = {
            database,
            buckets: [...new Set(bucketIds.split(',').map((id) => id.trim()).filter(Boolean))],
            extraRows: JSON.parse(extraRows)
        };
        if (!config.buckets.length || !config.extraRows || Array.isArray(config.extraRows) ||
            typeof config.extraRows !== 'object' || Object.values(config.extraRows).some((fields) =>
                !Array.isArray(fields) || !fields.length || fields.some((field) => typeof field !== 'string'))) {
            throw new Error('Invalid cleanup configuration');
        }
        step = 'Appwrite account lookup';
        const user = await request('GET', '/users/' + encodeURIComponent(proof.userId), { missing: true });
        if (user && user.$createdAt !== proof.created) {
            return res.status(400).json({ error: 'Verify the current account before deleting it.' });
        }
        step = 'Appwrite account cleanup';
        if (user) await deleteAccountData(request, config, user);
        return res.status(200).json({ deleted: true });
    } catch (error) {
        const stage = ['send', 'verify', 'delete'].includes(operation) ? operation : 'configuration';
        console.error('Self-service account deletion failed', { stage, step, status: error.status, missing });
        if (error.status === 429) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
        return res.status(503).json({ error: 'We could not complete this step. Please try again.' });
    }
};
