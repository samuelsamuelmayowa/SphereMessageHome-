const { createHash } = require('node:crypto');

module.exports = async function accountDeletion(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Use POST.' });
    }

    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email) || body.confirmed !== 'yes') {
        return res.status(400).json({ error: 'Enter your account email and confirm the request.' });
    }

    const data = { email };
    for (const [field, limit] of Object.entries({ smNumber: 80, phone: 80, username: 160, details: 2000 })) {
        const value = body[field];
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string' || value.length > limit) {
            return res.status(400).json({ error: 'Check the length of your optional details.' });
        }
        if (value.trim()) data[field] = value.trim();
    }

    const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_DATABASE_ID, APPWRITE_DELETION_API_KEY } = process.env;
    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_DATABASE_ID || !APPWRITE_DELETION_API_KEY) {
        const missing = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_DATABASE_ID', 'APPWRITE_DELETION_API_KEY']
            .filter((name) => !process.env[name]?.trim());
        console.error('Account deletion: missing environment variables', missing);
        return res.status(503).json({ error: 'Request submission is temporarily unavailable.' });
    }

    // Keep retries for the same email on the same UTC day in a single queue entry.
    const day = new Date().toISOString().slice(0, 10);
    const rowId = createHash('sha256').update(day + ':' + email).digest('hex').slice(0, 36);
    try {
        const endpoint = APPWRITE_ENDPOINT.replace(/\/+$/, '');
        const database = encodeURIComponent(APPWRITE_DATABASE_ID);
        const response = await fetch(`${endpoint}/tablesdb/${database}/tables/account_deletion_requests/rows`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Appwrite-Project': APPWRITE_PROJECT_ID,
                'X-Appwrite-Key': APPWRITE_DELETION_API_KEY
            },
            body: JSON.stringify({ rowId, data, permissions: [] }),
            signal: AbortSignal.timeout(8000)
        });
        if (response.ok || response.status === 409) {
            return res.status(202).json({ received: true });
        }
        console.error('Account deletion: Appwrite rejected the row', { status: response.status });
    } catch (error) {
        console.error('Account deletion: Appwrite request failed', {
            reason: error?.name === 'TimeoutError' ? 'timeout' : 'connection or invalid endpoint'
        });
        return res.status(503).json({ error: 'Request submission is temporarily unavailable.' });
    }
    return res.status(503).json({ error: 'Request submission is temporarily unavailable.' });
};
