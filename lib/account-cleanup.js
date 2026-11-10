const ownership = {
    hangouts: ['organizerUserId'],
    matches: ['userAId', 'userBId'],
    posts: ['userId'],
    likes: ['userId', 'senderUserId', 'receiverUserId'],
    hangout_members: ['userId'],
    moments: ['creatorUserId'],
    moment_members: ['userId'],
    moment_messages: ['senderUserId'],
    hangout_events: ['userId'],
    hangout_activity: ['actorUserId'],
    hangout_saves: ['userId'],
    hangout_invites: ['inviterUserId', 'inviteeUserId'],
    notifications: ['recipientUserId', 'actorUserId'],
    active_vibes: ['userId'],
    push_tokens: ['userId'],
    email_verifications: ['userId'],
    direct_messages: ['senderUserId'],
    direct_chats: ['userAId', 'userBId'],
    user_blocks: ['blockerUserId', 'blockedUserId'],
    user_profiles: ['userId']
};

function query(method, attribute, values) {
    return JSON.stringify({ method, attribute, values });
}

async function removeRows(request, path, filters, beforeDelete) {
    const params = new URLSearchParams();
    for (const filter of [...filters, query('limit', undefined, [50])]) {
        params.append('queries[]', filter);
    }
    for (;;) {
        const { rows } = await request('GET', path + '?' + params);
        if (rows.length === 0) return;
        for (const row of rows) {
            if (beforeDelete) await beforeDelete(row);
            await request('DELETE', path + '/' + encodeURIComponent(row.$id), { missing: true });
        }
    }
}

async function deleteAccountData(request, config, user) {
    const userId = user.$id;
    const userPath = '/users/' + encodeURIComponent(userId);
    const tablePath = (table) => '/tablesdb/' + encodeURIComponent(config.database) + '/tables/' + encodeURIComponent(table) + '/rows';
    const by = (field, value) => query('equal', field, [value]);

    const rowSelectors = { ...ownership, ...config.extraRows };
    const dependents = {
        hangouts: { hangout_members: 'hangoutId', hangout_events: 'hangoutId', hangout_activity: 'hangoutId', hangout_saves: 'hangoutId', hangout_invites: 'hangoutId' },
        posts: { likes: 'postId' },
        moments: { moment_members: 'momentId', moment_messages: 'momentId' },
        notifications: { push_delivery_jobs: 'notificationId' },
        active_vibes: { vibe_views: 'vibeId' }
    };
    const requestTable = '6af395c60022b7c114ba';

    // Catch missing tables and incompatible filters before changing the account.
    const checks = Object.entries(rowSelectors).flatMap(([table, fields]) =>
        fields.map((field) => [table, field, userId]));
    for (const children of Object.values(dependents)) {
        for (const [table, field] of Object.entries(children)) checks.push([table, field, userId]);
    }
    checks.push([requestTable, 'email', user.email]);
    for (let offset = 0; offset < checks.length; offset += 6) {
        await Promise.all(checks.slice(offset, offset + 6).map(([table, field, value]) => {
            const params = new URLSearchParams([
                ['queries[]', by(field, value)],
                ['queries[]', query('limit', undefined, [1])]
            ]);
            return request('GET', tablePath(table) + '?' + params);
        }));
    }

    await request('PATCH', userPath + '/status', { body: { status: false } });
    await request('DELETE', userPath + '/sessions');

    // File references in editable rows cannot establish ownership.
    const ownerPermission = 'delete("user:' + userId + '")';
    for (const bucket of config.buckets) {
        const path = '/storage/buckets/' + encodeURIComponent(bucket) + '/files';
        const params = new URLSearchParams();
        params.append('queries[]', query('limit', undefined, [100]));
        params.append('queries[]', query('orderAsc', '$id', []));
        const owned = [];
        for (;;) {
            const { files } = await request('GET', path + '?' + params);
            for (const file of files) {
                if (file.$permissions.includes(ownerPermission)) owned.push(file.$id);
            }
            if (files.length < 100) break;
            params.delete('queries[]');
            params.append('queries[]', query('limit', undefined, [100]));
            params.append('queries[]', query('orderAsc', '$id', []));
            params.append('queries[]', query('cursorAfter', undefined, [files.at(-1).$id]));
        }
        for (const id of owned) {
            await request('DELETE', path + '/' + encodeURIComponent(id), { missing: true });
        }
    }

    for (const [table, fields] of Object.entries(rowSelectors)) {
        for (const field of fields) {
            await removeRows(request, tablePath(table), [by(field, userId)], async (row) => {
                for (const [child, foreignKey] of Object.entries(dependents[table] ?? {})) {
                    await removeRows(request, tablePath(child), [by(foreignKey, row.$id)]);
                }
            });
        }
    }
    // Older clients can store the profile at the Auth user's ID.
    const profilePath = tablePath('user_profiles') + '/' + encodeURIComponent(userId);
    const profile = await request('GET', profilePath, { missing: true });
    if (profile && (!profile.userId || profile.userId === userId)) {
        await request('DELETE', profilePath, { missing: true });
    }

    await removeRows(request, tablePath(requestTable), [by('email', user.email)]);
    await request('DELETE', userPath, { missing: true });
}

module.exports = { deleteAccountData, query };
