const DEV_CAPABILITIES = ['account:review', 'preset:draft', 'preset:publish', 'admin:access'];

function ownerUsername(accountStore) {
  return accountStore.listAccounts().find(account => account.isOwner)?.username || null;
}

function ensureDevBackendPermissions(accountStore, member) {
  if (!accountStore || !member || member.role !== 'dev' || member.isOwner) return [];
  const owner = ownerUsername(accountStore);
  if (!owner) throw new Error('Owner account is missing');
  const existing = accountStore.listGrants().filter(grant => grant.subject === member.username);
  const created = [];
  for (const capability of DEV_CAPABILITIES) {
    if (existing.some(grant => grant.capability === capability && grant.scope === '*')) continue;
    try {
      created.push(accountStore.grant(owner, member.username, { capability, scope: '*' }));
    } catch (error) {
      if (error?.code !== 'CONFLICT') throw error;
    }
  }
  return created;
}

function devGrantActor(accountStore, username) {
  const account = accountStore.getAccount(username);
  if (account?.isOwner) return username;
  return ownerUsername(accountStore) || username;
}

module.exports = { DEV_CAPABILITIES, ensureDevBackendPermissions, devGrantActor };
