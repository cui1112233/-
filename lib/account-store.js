const crypto = require('node:crypto');
const path = require('node:path');

const { USERS, PRIMARY_USER } = require('./shared');
const {
  readJsonOrMissing,
  writeJsonAtomic,
  withJsonLock,
  writeJsonTransaction,
  recoverJsonTransaction
} = require('./system-store');

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const SCOPE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PASSWORD_HASH_PATTERN = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CAPABILITIES = new Set(['account:review', 'preset:draft', 'preset:publish']);
const ACCOUNT_FIELDS = new Set(['username', 'passwordHash', 'isOwner', 'active', 'createdAt', 'updatedAt']);
const GRANT_FIELDS = new Set(['id', 'at', 'actor', 'subject', 'capability', 'scope']);
const AUDIT_FIELDS = new Set(['id', 'at', 'actor', 'action', 'target', 'before', 'after']);

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function isValidScope(scope) {
  return scope === '*' || (typeof scope === 'string' && SCOPE_PATTERN.test(scope));
}

function isValidId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isValidTime(value) {
  return typeof value === 'string' && ISO_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidPasswordHash(value) {
  return typeof value === 'string' && PASSWORD_HASH_PATTERN.test(value);
}

function hasOnlyFields(value, allowedFields) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).every(key => allowedFields.has(key));
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password is required');
  }

  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function matchesPassword(passwordHash, password) {
  if (!isValidPasswordHash(passwordHash) || typeof password !== 'string') return false;

  const [, saltHex, expectedHex] = passwordHash.split('$');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicAccount(account) {
  if (!account) return null;
  return {
    username: account.username,
    isOwner: account.isOwner,
    active: account.active,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function publicGrant(grant) {
  return {
    id: grant.id,
    at: grant.at,
    actor: grant.actor,
    subject: grant.subject,
    capability: grant.capability,
    scope: grant.scope
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicAudit(entry) {
  return {
    id: entry.id,
    at: entry.at,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    before: null,
    after: publicGrant(entry.after)
  };
}

function effectivePermissions(account, grants) {
  if (!account) return [];
  if (account.username === PRIMARY_USER && account.isOwner === true) {
    return [{ capability: '*', scope: '*' }];
  }
  return (Array.isArray(grants) ? grants : [])
    .filter(grant => grant.subject === account.username)
    .map(grant => ({ capability: grant.capability, scope: grant.scope }));
}

function createAccountStore({ systemDir, lockTimeoutMs, lockRetryMs }) {
  if (typeof systemDir !== 'string' || systemDir.length === 0) {
    throw new Error('systemDir is required');
  }

  const files = {
    accounts: path.join(systemDir, 'accounts.json'),
    applications: path.join(systemDir, 'applications.json'),
    grants: path.join(systemDir, 'grants.json'),
    audit: path.join(systemDir, 'audit.json'),
    transaction: path.join(systemDir, 'system-transaction.json'),
    lock: path.join(systemDir, 'system-store.lock')
  };
  const transactionPaths = [files.grants, files.audit];
  const lockOptions = {
    ...(lockTimeoutMs === undefined ? {} : { timeoutMs: lockTimeoutMs }),
    ...(lockRetryMs === undefined ? {} : { retryMs: lockRetryMs })
  };

  function withStoreLock(operation) {
    return withJsonLock(files.lock, operation, lockOptions);
  }

  function validateAccounts(accounts) {
    const usernames = new Set();
    let primaryAccount = null;
    let ownerCount = 0;

    for (const account of accounts) {
      if (!hasOnlyFields(account, ACCOUNT_FIELDS) || !isValidUsername(account.username)
        || typeof account.active !== 'boolean' || !isValidPasswordHash(account.passwordHash)
        || !isValidTime(account.createdAt) || !isValidTime(account.updatedAt)) {
        throw new Error('Invalid account store');
      }
      if (usernames.has(account.username) || typeof account.isOwner !== 'boolean') {
        throw new Error('Invalid account ownership');
      }
      usernames.add(account.username);
      if (account.username === PRIMARY_USER) primaryAccount = account;
      if (account.isOwner) ownerCount += 1;
    }

    if (!primaryAccount || primaryAccount.isOwner !== true || ownerCount !== 1) {
      throw new Error('Invalid account ownership');
    }
    return accounts;
  }

  function readArray(filePath, label) {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return [];
    if (!Array.isArray(result.value)) throw new Error(`Invalid ${label} store`);
    return result.value;
  }

  function validateGrant(grant, usernames) {
    if (!hasOnlyFields(grant, GRANT_FIELDS) || !isValidId(grant.id) || !isValidTime(grant.at)
      || grant.actor !== PRIMARY_USER || !isValidUsername(grant.subject) || !usernames.has(grant.subject)
      || !CAPABILITIES.has(grant.capability) || !isValidScope(grant.scope)) {
      throw new Error('Invalid grant store');
    }
  }

  function validateGrants(grants, accounts) {
    const usernames = new Set(accounts.map(account => account.username));
    const grantIds = new Set();
    const permissions = new Set();
    for (const grant of grants) {
      validateGrant(grant, usernames);
      const permissionKey = `${grant.subject}\u0000${grant.capability}\u0000${grant.scope}`;
      if (grantIds.has(grant.id) || permissions.has(permissionKey)) throw new Error('Invalid grant store');
      grantIds.add(grant.id);
      permissions.add(permissionKey);
    }
    return grants;
  }

  function validateAudit(audit, accounts, grants) {
    const usernames = new Set(accounts.map(account => account.username));
    const grantIds = new Set(grants.map(grant => grant.id));
    const auditIds = new Set();
    const auditedGrantIds = new Set();

    for (const entry of audit) {
      if (!hasOnlyFields(entry, AUDIT_FIELDS) || !isValidId(entry.id) || !isValidTime(entry.at)
        || entry.actor !== PRIMARY_USER || entry.action !== 'grant.created' || !isValidUsername(entry.target)
        || !usernames.has(entry.target) || !Object.hasOwn(entry, 'before') || !Object.hasOwn(entry, 'after')
        || entry.before !== null) {
        throw new Error('Invalid audit store');
      }
      validateGrant(entry.after, usernames);
      if (entry.target !== entry.after.subject || entry.actor !== entry.after.actor
        || !grantIds.has(entry.after.id) || auditIds.has(entry.id) || auditedGrantIds.has(entry.after.id)) {
        throw new Error('Invalid audit store');
      }
      auditIds.add(entry.id);
      auditedGrantIds.add(entry.after.id);
    }
    if (auditedGrantIds.size !== grantIds.size) throw new Error('Invalid audit store');
    return audit;
  }

  function readAccountsUnsafe() {
    const result = readJsonOrMissing(files.accounts);
    if (!result.found) return { found: false, accounts: [] };
    if (!Array.isArray(result.value)) throw new Error('Invalid account store');
    return { found: true, accounts: validateAccounts(result.value) };
  }

  function validateJournalWrites(journal) {
    const accountsState = readAccountsUnsafe();
    if (!accountsState.found) throw new Error('Invalid account store');
    if (journal.writes.length !== 2) throw new Error('Invalid JSON transaction journal');
    const grantsWrite = journal.writes.find(write => path.resolve(write.filePath) === path.resolve(files.grants));
    const auditWrite = journal.writes.find(write => path.resolve(write.filePath) === path.resolve(files.audit));
    if (!grantsWrite || !auditWrite || !Array.isArray(grantsWrite.value) || !Array.isArray(auditWrite.value)) {
      throw new Error('Invalid JSON transaction journal');
    }
    validateGrants(grantsWrite.value, accountsState.accounts);
    validateAudit(auditWrite.value, accountsState.accounts, grantsWrite.value);
  }

  function recoverPendingTransactionUnsafe() {
    return recoverJsonTransaction(files.transaction, {
      allowedPaths: transactionPaths,
      validateJournal: validateJournalWrites
    });
  }

  function readStateUnsafe() {
    recoverPendingTransactionUnsafe();
    const accountsState = readAccountsUnsafe();
    const grants = readArray(files.grants, 'grant');
    const audit = readArray(files.audit, 'audit');
    if (!accountsState.found) {
      if (grants.length !== 0 || audit.length !== 0) throw new Error('Invalid account store');
      return { accounts: [], grants, audit };
    }
    validateGrants(grants, accountsState.accounts);
    validateAudit(audit, accountsState.accounts, grants);
    return { accounts: accountsState.accounts, grants, audit };
  }

  function findAccount(accounts, username) {
    if (!isValidUsername(username)) return null;
    return accounts.find(account => account.username === username) || null;
  }

  function ensureSeedAccounts(seedUsers = USERS) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      if (state.accounts.length !== 0) return false;
      if (!seedUsers || typeof seedUsers !== 'object' || Array.isArray(seedUsers)) {
        throw new Error('Seed users must be an object');
      }

      const now = new Date().toISOString();
      const accounts = Object.entries(seedUsers).map(([username, password]) => {
        if (!isValidUsername(username)) throw new Error(`Invalid username: ${username}`);
        return {
          username,
          passwordHash: hashPassword(password),
          isOwner: username === PRIMARY_USER,
          active: true,
          createdAt: now,
          updatedAt: now
        };
      });

      validateAccounts(accounts);
      writeJsonAtomic(files.accounts, accounts);
      return true;
    });
  }

  function getAccount(username) {
    return withStoreLock(() => publicAccount(findAccount(readStateUnsafe().accounts, username)));
  }

  function getInternalAccount(username) {
    return withStoreLock(() => {
      const account = findAccount(readStateUnsafe().accounts, username);
      return account ? clone(account) : null;
    });
  }

  function listAccounts() {
    return withStoreLock(() => readStateUnsafe().accounts.map(publicAccount));
  }

  function verifyPassword(username, password) {
    return withStoreLock(() => {
      const account = findAccount(readStateUnsafe().accounts, username);
      return Boolean(account && matchesPassword(account.passwordHash, password));
    });
  }

  function setOwner(username) {
    return withStoreLock(() => {
      const account = findAccount(readStateUnsafe().accounts, username);
      if (!account || username !== PRIMARY_USER || !account.isOwner) {
        throw new Error('owner is immutable');
      }
      throw new Error('owner is immutable');
    });
  }

  function setActive(username, active) {
    if (!isValidUsername(username)) throw new Error('Invalid username');
    if (typeof active !== 'boolean') throw new Error('Active status must be boolean');

    return withStoreLock(() => {
      const state = readStateUnsafe();
      const index = state.accounts.findIndex(account => account.username === username);
      if (index === -1) throw new Error('Account not found');

      state.accounts[index] = {
        ...state.accounts[index],
        active,
        updatedAt: new Date().toISOString()
      };
      validateAccounts(state.accounts);
      writeJsonAtomic(files.accounts, state.accounts);
      return publicAccount(state.accounts[index]);
    });
  }

  function listGrants(subject) {
    if (subject !== undefined && !isValidUsername(subject)) return [];
    return withStoreLock(() => readStateUnsafe().grants
      .filter(grant => subject === undefined || grant.subject === subject)
      .map(publicGrant));
  }

  function grant(actorUsername, subject, { capability, scope } = {}) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const actor = findAccount(state.accounts, actorUsername);
      if (!actor || !actor.active || !actor.isOwner || actor.username !== PRIMARY_USER) {
        throw new Error('Actor must be an active owner');
      }
      if (!isValidUsername(subject)) throw new Error('Invalid subject username');
      if (!CAPABILITIES.has(capability)) throw new Error('Invalid capability');
      if (!isValidScope(scope)) throw new Error('Invalid scope');

      const subjectAccount = findAccount(state.accounts, subject);
      if (!subjectAccount || !subjectAccount.active) throw new Error('Subject must be an active account');
      if (state.grants.some(grantItem => grantItem.subject === subject && grantItem.capability === capability && grantItem.scope === scope)) {
        throw new Error('Grant already exists');
      }

      const created = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor: actor.username,
        subject,
        capability,
        scope
      };
      const entry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor: actor.username,
        action: 'grant.created',
        target: subject,
        before: null,
        after: publicGrant(created)
      };

      writeJsonTransaction(files.transaction, [
        { filePath: files.grants, value: [...state.grants, created] },
        { filePath: files.audit, value: [...state.audit, entry] }
      ], {
        allowedPaths: transactionPaths,
        validateJournal: validateJournalWrites
      });
      return clone(created);
    });
  }

  function can(accountOrUsername, capability, scope) {
    if (!CAPABILITIES.has(capability) || !isValidScope(scope)) return false;
    const username = typeof accountOrUsername === 'string' ? accountOrUsername : accountOrUsername?.username;
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const account = findAccount(state.accounts, username);
      if (!account || !account.active) return false;
      return effectivePermissions(account, state.grants)
        .some(permission => (permission.capability === '*' || permission.capability === capability)
          && (permission.scope === '*' || permission.scope === scope));
    });
  }

  withStoreLock(readStateUnsafe);

  return {
    ensureSeedAccounts,
    getAccount,
    getInternalAccount,
    listAccounts,
    verifyPassword,
    setOwner,
    setActive,
    effectivePermissions: accountOrUsername => {
      const username = typeof accountOrUsername === 'string' ? accountOrUsername : accountOrUsername?.username;
      return withStoreLock(() => {
        const state = readStateUnsafe();
        return effectivePermissions(findAccount(state.accounts, username), state.grants);
      });
    },
    can,
    grant,
    listGrants,
    listAudit: () => withStoreLock(() => readStateUnsafe().audit.map(publicAudit)),
    files: { ...files }
  };
}

module.exports = { createAccountStore, CAPABILITIES, effectivePermissions };
