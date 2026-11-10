const { test } = require('node:test');
const assert = require('node:assert/strict');
const endpoint = require('../api/self-service-deletion');

test('email verification, cleanup failure, retry, and account deletion', async (t) => {
    Object.assign(process.env, {
        APPWRITE_ENDPOINT: 'https://appwrite.example/v1',
        APPWRITE_PROJECT_ID: 'test',
        APPWRITE_DATABASE_ID: 'main',
        APPWRITE_SELF_DELETION_API_KEY: 'mock-key',
        ACCOUNT_DELETION_SECRET: 'mock-secret-with-at-least-32-characters',
        ACCOUNT_DELETION_BUCKET_IDS: 'photos',
        ACCOUNT_DELETION_EXTRA_ROWS: '{"comments":["userId"]}'
    });

    const user = { $id: 'owner', $createdAt: '2026-01-01', email: 'test@example.com' };
    const profile = { $id: 'profile', userId: 'owner' };
    const otherProfile = { $id: 'another', userId: 'other' };
    const post = { $id: 'my-post', userId: 'owner' };
    const like = { $id: 'their-like', userId: 'other', postId: 'my-post' };
    const comment = { $id: 'comment', userId: 'owner' };
    const rows = { user_profiles: [profile, otherProfile], posts: [post], likes: [like], comments: [comment] };
    const mutations = [];
    let userExists = true;
    let failFileDelete = true;
    let codeSent = false;
    const files = [
        { $id: 'my-photo', $permissions: ['delete("user:owner")'] },
        { $id: 'their-photo', $permissions: ['delete("user:other")'] }
    ];
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });

    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async (target, options) => {
        const url = new URL(target);
        const path = url.pathname.slice(3);
        const method = options.method;
        if (method !== 'GET') mutations.push([method, path]);
        if (path === '/users') return reply({ users: [user] });
        if (path === '/account/tokens/email') {
            assert.equal(options.headers['X-Appwrite-Key'], undefined);
            codeSent = true;
            return reply({ userId: 'owner' });
        }
        if (path === '/account/sessions/token') {
            assert.equal(options.headers['X-Appwrite-Key'], undefined);
            return codeSent && JSON.parse(options.body).secret === '123456'
                ? reply({ userId: 'owner', $id: 'verification-session' })
                : reply({}, 401);
        }
        if (path === '/users/owner' && method === 'GET') return userExists ? reply(user) : reply({}, 404);
        if (path === '/users/owner' && method === 'DELETE') {
            assert.deepEqual(rows.user_profiles, [otherProfile]);
            assert.deepEqual(rows.posts, []);
            assert.deepEqual(rows.likes, []);
            assert.deepEqual(rows.comments, []);
            assert.deepEqual(files.map((file) => file.$id), ['their-photo']);
            userExists = false;
            return new Response(null, { status: 204 });
        }
        if (path.startsWith('/users/owner/')) return reply({});
        if (path.endsWith('/photos/files')) return reply({ files });
        if (path.endsWith('/photos/files/my-photo') && method === 'DELETE') {
            if (failFileDelete) return reply({}, 500);
            files.shift();
            return new Response(null, { status: 204 });
        }
        const match = path.match(/^\/tablesdb\/main\/tables\/([^/]+)\/rows(?:\/([^/]+))?$/);
        assert.ok(match, path);
        const table = rows[match[1]] ?? [];
        if (match[2] && method === 'DELETE') {
            table.splice(table.findIndex((row) => row.$id === match[2]), 1);
            return new Response(null, { status: 204 });
        }
        if (match[2]) return reply({}, 404);
        const equal = url.searchParams.getAll('queries[]').map(JSON.parse).find((filter) => filter.method === 'equal');
        return reply({ rows: table.filter((row) => equal.values.includes(row[equal.attribute])) });
    });

    function call(body) {
        const res = {
            setHeader() {},
            status(code) { this.code = code; return this; },
            json(result) { return { status: this.code, ...result }; }
        };
        return endpoint({ method: 'POST', body }, res);
    }

    const { challenge } = await call({ action: 'send', email: user.email });
    assert.equal((await call({ action: 'delete', proof: challenge, confirmed: true })).status, 400);
    assert.equal((await call({ action: 'verify', proof: challenge, code: '999999' })).status, 400);
    const { proof } = await call({ action: 'verify', proof: challenge, code: '123456' });
    assert.equal((await call({ action: 'delete', proof: proof + 'x', confirmed: true })).status, 400);
    assert.equal((await call({ action: 'delete', proof, confirmed: false })).status, 400);

    const deletion = { action: 'delete', proof, confirmed: true };
    assert.equal((await call(deletion)).status, 503);
    assert.equal(userExists, true);
    failFileDelete = false;
    assert.deepEqual(await call(deletion), { status: 200, deleted: true });
    assert.deepEqual(mutations.at(-1), ['DELETE', '/users/owner']);
    assert.deepEqual(await call(deletion), { status: 200, deleted: true });
});
