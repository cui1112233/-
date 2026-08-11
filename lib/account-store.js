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
const APPLICATION_STATUSES = new Set(['pending', 'approved', 'rejected', 'withdrawn']);
const ACCOUNT_FIELDS = new Set(['username', 'passwordHash', 'isOwner', 'active', 'createdAt', 'updatedAt']);
const APPLICATION_FIELDS = new Set(['id', 'username', 'passwordHash', 'reason', 'status', 'createdAt', 'updatedAt', 'reviewedAt', 'reviewedBy']);
const GRANT_FIELDS = new Set(['id', 'at', 'actor', 'subject', 'capability', 'scope']);
const AUDIT_FIELDS = new Set(['id', 'at', 'actor', 'action', 'target', 'before', 'after']);

function storeError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value, allowedFields) {
  return isPlainObject(value) && Object.keys(value).every(key => allowedFields.has(key));
}

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

function isValidReason(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
}

function isValidNewPassword(value) {
  return typeof value === 'string' && value.length >= 8;
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw storeError('Password is required');
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function publicApplication(application) {
  if (!application) return null;
  return {
    id: application.id,
    username: application.username,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

function reviewApplication(application) {
  return {
    ...publicApplication(application),
    reason: application.reason,
    reviewedAt: application.reviewedAt,
    reviewedBy: application.reviewedBy
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

function publicAudit(entry) {
  return {
    id: entry.id,
    at: entry.at,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    before: clone(entry.before),
    after: clone(entry.after)
  };
}

function applicationSummary(application) {
  return { id: application.id, status: application.status };
}

function activeSummary(active) {
  return { active };
}

function passwordResetSummary() {
  return { passwordReset: true };
}

function accountSummary(account) {
  return { active: account.active, isOwner: account.isOwner };
}

function isApplicationSummary(value) {
  return hasOnlyFields(value, new Set(['id', 'status'])) && isValidId(value.id) && APPLICATION_STATUSES.has(value.status);
}

function isActiveSummary(value) {
  return hasOnlyFields(value, new Set(['active'])) && typeof value.active === 'boolean';
}

function isPasswordResetSummary(value) {
  return hasOnlyFields(value, new Set(['passwordReset'])) && value.passwordReset === true;
}

function isAccountSummary(value) {
  return hasOnlyFields(value, new Set(['active', 'isOwner']))
    && typeof value.active === 'boolean' && typeof value.isOwner === 'boolean';
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
  const transactionPaths = [files.accounts, files.applications, files.grants, files.audit];
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
        || typeof account.active !== 'boolean' || typeof account.isOwner !== 'boolean'
        || !isValidPasswordHash(account.passwordHash) || !isValidTime(account.createdAt)
        || !isValidTime(account.updatedAt)) {
        throw new Error('Invalid account store');
      }
      if (usernames.has(account.username)) throw new Error('Invalid account ownership');
      usernames.add(account.username);
      if (account.username === PRIMARY_USER) primaryAccount = account;
      if (account.isOwner) ownerCount += 1;
    }
    if (!primaryAccount || primaryAccount.isOwner !== true || ownerCount !== 1) {
      throw new Error('Invalid account ownership');
    }
    return accounts;
  }

  function validateApplications(applications, accounts) {
    const ids = new Set();
    const pendingUsernames = new Set();
    const usernames = new Set(accounts.map(account => account.username));
    for (const application of applications) {
      if (!hasOnlyFields(application, APPLICATION_FIELDS) || !isValidId(application.id)
        || !isValidUsername(application.username) || !isValidPasswordHash(application.passwordHash)
        || !isValidReason(application.reason) || !APPLICATION_STATUSES.has(application.status)
        || !isValidTime(application.createdAt) || !isValidTime(application.updatedAt)) {
        throw new Error('Invalid application store');
      }
      if (ids.has(application.id)) throw new Error('Invalid application store');
      ids.add(application.id);
      if (application.status === 'pending') {
        if (pendingUsernames.has(application.username) || application.reviewedAt !== null || application.reviewedBy !== null) {
          throw new Error('Invalid application store');
        }
        pendingUsernames.add(application.username);
      } else if (application.status === 'withdrawn') {
        if (application.reviewedAt !== null || application.reviewedBy !== null) throw new Error('Invalid application store');
      } else if (!isValidTime(application.reviewedAt) || !isValidUsername(application.reviewedBy)
        || !usernames.has(application.reviewedBy)) {
        throw new Error('Invalid application store');
      }
      if (application.status === 'approved' && !usernames.has(application.username)) {
        throw new Error('Invalid application store');
      }
    }
    return applications;
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

  function validateAuditEntry(entry, accounts, applications, grants) {
    const usernames = new Set(accounts.map(account => account.username));
    const applicationsById = new Map(applications.map(application => [application.id, application]));
    if (!hasOnlyFields(entry, AUDIT_FIELDS) || !isValidId(entry.id) || !isValidTime(entry.at)
      || !isValidUsername(entry.actor) || !isValidUsername(entry.target)) {
      throw new Error('Invalid audit store');
    }
    if (entry.action === 'grant.created') {
      validateGrant(entry.after, usernames);
      if (entry.before !== null || entry.target !== entry.after.subject || entry.actor !== entry.after.actor) {
        throw new Error('Invalid audit store');
      }
      return;
    }
    if (entry.action === 'grant.revoked') {
      validateGrant(entry.before, usernames);
      if (entry.after !== null || entry.target !== entry.before.subject || entry.actor !== PRIMARY_USER) throw new Error('Invalid audit store');
      return;
    }
    if (entry.action === 'application.submitted') {
      const application = applicationsById.get(entry.after?.id);
      if (entry.before !== null || !isApplicationSummary(entry.after) || entry.after.status !== 'pending'
        || entry.actor !== entry.target || !application || application.username !== entry.target) throw new Error('Invalid audit store');
      return;
    }
    if (entry.action === 'application.approved' || entry.action === 'application.rejected' || entry.action === 'application.withdrawn') {
      const application = applicationsById.get(entry.after?.id);
      const expectedStatus = entry.action.slice('application.'.length);
      if (!isApplicationSummary(entry.before) || !isApplicationSummary(entry.after)
        || entry.after.status !== expectedStatus || !application || application.username !== entry.target
        || (entry.action === 'application.withdrawn'
          ? entry.actor !== entry.target
          : !usernames.has(entry.actor))) throw new Error('Invalid audit store');
      return;
    }
    if (entry.action === 'account.status_changed') {
      if (!isActiveSummary(entry.before) || !isActiveSummary(entry.after)
        || !usernames.has(entry.actor) || !usernames.has(entry.target)) throw new Error('Invalid audit store');
      return;
    }
    if (entry.action === 'account.password_reset') {
      if (entry.before !== null || !isPasswordResetSummary(entry.after)
        || !usernames.has(entry.actor) || !usernames.has(entry.target)) throw new Error('Invalid audit store');
      return;
    }
    if (entry.action === 'account.created') {
      const account = accounts.find(candidate => candidate.username === entry.target);
      if (entry.before !== null || !isAccountSummary(entry.after) || entry.actor !== PRIMARY_USER
        || entry.target === PRIMARY_USER || entry.after.isOwner !== false || !account || account.isOwner !== false) {
        throw new Error('Invalid audit store');
      }
      return;
    }
    throw new Error('Invalid audit store');
  }

  function validateAudit(audit, accounts, applications, grants) {
    const auditIds = new Set();
    const createdGrants = new Map();
    const revokedGrantIds = new Set();
    for (const entry of audit) {
      validateAuditEntry(entry, accounts, applications, grants);
      if (auditIds.has(entry.id)) throw new Error('Invalid audit store');
      auditIds.add(entry.id);
      if (entry.action === 'grant.created') {
        if (createdGrants.has(entry.after.id)) throw new Error('Invalid audit store');
        createdGrants.set(entry.after.id, entry.after);
      }
      if (entry.action === 'grant.revoked') {
        if (revokedGrantIds.has(entry.before.id)) throw new Error('Invalid audit store');
        revokedGrantIds.add(entry.before.id);
      }
    }
    for (const id of revokedGrantIds) {
      const created = createdGrants.get(id);
      const revoked = audit.find(entry => entry.action === 'grant.revoked' && entry.before.id === id);
      if (!created || JSON.stringify(created) !== JSON.stringify(revoked.before)) throw new Error('Invalid audit store');
      createdGrants.delete(id);
    }
    if (createdGrants.size !== grants.length) throw new Error('Invalid audit store');
    for (const grant of grants) {
      if (JSON.stringify(createdGrants.get(grant.id)) !== JSON.stringify(grant)) throw new Error('Invalid audit store');
    }
    return audit;
  }

  function readAccountsUnsafe() {
    const result = readJsonOrMissing(files.accounts);
    if (!result.found) return { found: false, accounts: [] };
    if (!Array.isArray(result.value)) throw new Error('Invalid account store');
    return { found: true, accounts: validateAccounts(result.value) };
  }

  function readStateUnsafe() {
    recoverPendingTransactionUnsafe();
    const accountsState = readAccountsUnsafe();
    const applications = readArray(files.applications, 'application');
    const grants = readArray(files.grants, 'grant');
    const audit = readArray(files.audit, 'audit');
    if (!accountsState.found) {
      if (applications.length !== 0 || grants.length !== 0 || audit.length !== 0) throw new Error('Invalid account store');
      return { accounts: [], applications, grants, audit };
    }
    validateApplications(applications, accountsState.accounts);
    validateGrants(grants, accountsState.accounts);
    validateAudit(audit, accountsState.accounts, applications, grants);
    return { accounts: accountsState.accounts, applications, grants, audit };
  }

  function validateJournalWrites(journal) {
    if (!journal || !Array.isArray(journal.writes) || journal.writes.length < 1 || journal.writes.length > 4) {
      throw new Error('Invalid JSON transaction journal');
    }
    const auditWrite = journal.writes.find(write => path.resolve(write.filePath) === path.resolve(files.audit));
    if (!auditWrite || !Array.isArray(auditWrite.value)) throw new Error('Invalid JSON transaction journal');
    if (journal.writes.length === 1 && path.resolve(journal.writes[0].filePath) !== path.resolve(files.audit)) {
      throw new Error('Invalid JSON transaction journal');
    }
    const paths = new Set();
    for (const write of journal.writes) {
      const resolved = path.resolve(write.filePath);
      if (!transactionPaths.some(allowed => path.resolve(allowed) === resolved) || paths.has(resolved) || !Array.isArray(write.value)) {
        throw new Error('Invalid JSON transaction journal');
      }
      paths.add(resolved);
    }
    const accountsState = readAccountsUnsafe();
    const current = {
      accounts: accountsState.accounts,
      applications: readArray(files.applications, 'application'),
      grants: readArray(files.grants, 'grant'),
      audit: readArray(files.audit, 'audit')
    };
    for (const write of journal.writes) {
      const key = Object.entries(files).find(([, value]) => path.resolve(value) === path.resolve(write.filePath))?.[0];
      if (!key || key === 'transaction' || key === 'lock') throw new Error('Invalid JSON transaction journal');
      current[key] = write.value;
    }
    if (current.accounts.length === 0) throw new Error('Invalid account store');
    validateAccounts(current.accounts);
    validateApplications(current.applications, current.accounts);
    validateGrants(current.grants, current.accounts);
    validateAudit(current.audit, current.accounts, current.applications, current.grants);
  }

  function recoverPendingTransactionUnsafe() {
    return recoverJsonTransaction(files.transaction, {
      allowedPaths: transactionPaths,
      validateJournal: validateJournalWrites
    });
  }

  function findAccount(accounts, username) {
    if (!isValidUsername(username)) return null;
    return accounts.find(account => account.username === username) || null;
  }

  function findApplication(applications, id) {
    if (!isValidId(id)) return null;
    return applications.find(application => application.id === id) || null;
  }

  function appendAuditToState(state, actor, action, target, before, after) {
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      target,
      before,
      after
    };
    validateAuditEntry(entry, state.accounts, state.applications, state.grants);
    state.audit.push(entry);
    return entry;
  }

  function writeTransaction(changes) {
    writeJsonTransaction(files.transaction, changes, {
      allowedPaths: transactionPaths,
      validateJournal: validateJournalWrites
    });
  }

  function ensureReviewer(state, actorUsername) {
    const actor = findAccount(state.accounts, actorUsername);
    if (!actor || !actor.active || !effectivePermissions(actor, state.grants)
      .some(permission => (permission.capability === '*' || permission.capability === 'account:review')
        && permission.scope === '*')) {
      throw storeError('Actor must have account review permission', 'FORBIDDEN');
    }
    return actor;
  }

  function ensureOwner(state, actorUsername) {
    const actor = findAccount(state.accounts, actorUsername);
    if (!actor || !actor.active || !actor.isOwner || actor.username !== PRIMARY_USER) {
      throw storeError('Actor must be an active owner', 'FORBIDDEN');
    }
    return actor;
  }

  function ensureSeedAccounts(seedUsers = USERS) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      if (state.accounts.length !== 0) return false;
      if (!seedUsers || typeof seedUsers !== 'object' || Array.isArray(seedUsers)) throw new Error('Seed users must be an object');
      const now = new Date().toISOString();
      const accounts = Object.entries(seedUsers).map(([username, password]) => {
        if (!isValidUsername(username)) throw new Error(`Invalid username: ${username}`);
        return { username, passwordHash: hashPassword(password), isOwner: username === PRIMARY_USER, active: true, createdAt: now, updatedAt: now };
      });
      validateAccounts(accounts);
      writeJsonAtomic(files.accounts, accounts);
      return true;
    });
  }

  function createAccountRecord(state, { username, password, passwordHash, active = true } = {}) {
    if (!isValidUsername(username)) throw storeError('Invalid username');
    if (typeof active !== 'boolean') throw storeError('Active status must be boolean');
    if (findAccount(state.accounts, username)) throw storeError('Account already exists', 'CONFLICT');
    const resolvedPasswordHash = passwordHash === undefined ? (() => {
      if (!isValidNewPassword(password)) throw storeError('Password must be at least 8 characters');
      return hashPassword(password);
    })() : passwordHash;
    if (!isValidPasswordHash(resolvedPasswordHash)) throw storeError('Invalid password hash');
    const now = new Date().toISOString();
    const account = {
      username,
      passwordHash: resolvedPasswordHash,
      isOwner: false,
      active,
      createdAt: now,
      updatedAt: now
    };
    state.accounts.push(account);
    return account;
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

  function createAccount({ username, password, active = true } = {}) {
    if (!isValidUsername(username)) throw storeError('Invalid username');
    if (!isValidNewPassword(password)) throw storeError('Password must be at least 8 characters');
    if (typeof active !== 'boolean') throw storeError('Active status must be boolean');
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const account = createAccountRecord(state, { username, password, active });
      appendAuditToState(state, PRIMARY_USER, 'account.created', account.username, null, accountSummary(account));
      writeTransaction([
        { filePath: files.accounts, value: state.accounts },
        { filePath: files.audit, value: state.audit }
      ]);
      return publicAccount(account);
    });
  }

  function submitApplication({ username, password, reason } = {}) {
    if (!isValidUsername(username)) throw storeError('Invalid username');
    if (!isValidNewPassword(password)) throw storeError('Password must be at least 8 characters');
    if (!isValidReason(reason)) throw storeError('Reason is required');
    return withStoreLock(() => {
      const state = readStateUnsafe();
      if (findAccount(state.accounts, username) || state.applications.some(application => application.username === username && application.status === 'pending')) {
        throw storeError('Username is unavailable', 'CONFLICT');
      }
      const now = new Date().toISOString();
      const application = {
        id: crypto.randomUUID(), username, passwordHash: hashPassword(password), reason: reason.trim(), status: 'pending',
        createdAt: now, updatedAt: now, reviewedAt: null, reviewedBy: null
      };
      state.applications.push(application);
      appendAuditToState(state, username, 'application.submitted', username, null, applicationSummary(application));
      writeTransaction([
        { filePath: files.applications, value: state.applications },
        { filePath: files.audit, value: state.audit }
      ]);
      return publicApplication(application);
    });
  }

  function getApplication(id) {
    return withStoreLock(() => publicApplication(findApplication(readStateUnsafe().applications, id)));
  }

  function getApplicationStatus(username, id, password) {
    return withStoreLock(() => {
      const application = findApplication(readStateUnsafe().applications, id);
      if (!application || application.username !== username || !matchesPassword(application.passwordHash, password)) return null;
      return publicApplication(application);
    });
  }

  function listApplications() {
    return withStoreLock(() => readStateUnsafe().applications.map(reviewApplication));
  }

  function approveApplication(actorUsername, id) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const actor = ensureReviewer(state, actorUsername);
      const application = findApplication(state.applications, id);
      if (!application) throw storeError('Application not found', 'NOT_FOUND');
      if (application.status !== 'pending') throw storeError('Application is not pending', 'CONFLICT');
      const account = createAccountRecord(state, {
        username: application.username,
        passwordHash: application.passwordHash,
        active: true
      });
      const before = applicationSummary(application);
      const now = new Date().toISOString();
      application.status = 'approved';
      application.updatedAt = now;
      application.reviewedAt = now;
      application.reviewedBy = actor.username;
      appendAuditToState(state, actor.username, 'application.approved', application.username, before, applicationSummary(application));
      writeTransaction([
        { filePath: files.accounts, value: state.accounts },
        { filePath: files.applications, value: state.applications },
        { filePath: files.audit, value: state.audit }
      ]);
      return { application: reviewApplication(application), account: publicAccount(account) };
    });
  }

  function rejectApplication(actorUsername, id) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const actor = ensureReviewer(state, actorUsername);
      const application = findApplication(state.applications, id);
      if (!application) throw storeError('Application not found', 'NOT_FOUND');
      if (application.status !== 'pending') throw storeError('Application is not pending', 'CONFLICT');
      const before = applicationSummary(application);
      const now = new Date().toISOString();
      application.status = 'rejected';
      application.updatedAt = now;
      application.reviewedAt = now;
      application.reviewedBy = actor.username;
      appendAuditToState(state, actor.username, 'application.rejected', application.username, before, applicationSummary(application));
      writeTransaction([
        { filePath: files.applications, value: state.applications },
        { filePath: files.audit, value: state.audit }
      ]);
      return reviewApplication(application);
    });
  }

  function withdrawApplication(username, id, password) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const application = findApplication(state.applications, id);
      if (!application || application.username !== username || !matchesPassword(application.passwordHash, password)) {
        throw storeError('Application not found', 'NOT_FOUND');
      }
      if (application.status !== 'pending') throw storeError('Application is not pending', 'CONFLICT');
      const before = applicationSummary(application);
      application.status = 'withdrawn';
      application.updatedAt = new Date().toISOString();
      appendAuditToState(state, username, 'application.withdrawn', username, before, applicationSummary(application));
      writeTransaction([
        { filePath: files.applications, value: state.applications },
        { filePath: files.audit, value: state.audit }
      ]);
      return publicApplication(application);
    });
  }

  function setOwner(username) {
    return withStoreLock(() => {
      const account = findAccount(readStateUnsafe().accounts, username);
      if (!account || username !== PRIMARY_USER || !account.isOwner) throw new Error('owner is immutable');
      throw new Error('owner is immutable');
    });
  }

  function setActive(actorOrUsername, usernameOrActive, requestedActive) {
    const legacyCall = requestedActive === undefined;
    const actorUsername = legacyCall ? PRIMARY_USER : actorOrUsername;
    const username = legacyCall ? actorOrUsername : usernameOrActive;
    const active = legacyCall ? usernameOrActive : requestedActive;
    if (!isValidUsername(username)) throw storeError('Invalid username');
    if (typeof active !== 'boolean') throw storeError('Active status must be boolean');
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const actor = legacyCall ? ensureOwner(state, actorUsername) : ensureReviewer(state, actorUsername);
      const account = findAccount(state.accounts, username);
      if (!account) throw storeError('Account not found', 'NOT_FOUND');
      if (account.username === PRIMARY_USER && !active) throw storeError('Primary owner must remain active');
      const before = activeSummary(account.active);
      account.active = active;
      account.updatedAt = new Date().toISOString();
      appendAuditToState(state, actor.username, 'account.status_changed', account.username, before, activeSummary(account.active));
      writeTransaction([
        { filePath: files.accounts, value: state.accounts },
        { filePath: files.audit, value: state.audit }
      ]);
      return publicAccount(account);
    });
  }

  function resetPassword(actorUsername, username, password) {
    if (!isValidUsername(username)) throw storeError('Invalid username');
    if (!isValidNewPassword(password)) throw storeError('Password must be at least 8 characters');
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const actor = ensureReviewer(state, actorUsername);
      const account = findAccount(state.accounts, username);
      if (!account) throw storeError('Account not found', 'NOT_FOUND');
      account.passwordHash = hashPassword(password);
      account.updatedAt = new Date().toISOString();
      appendAuditToState(state, actor.username, 'account.password_reset', account.username, null, passwordResetSummary());
      writeTransaction([
        { filePath: files.accounts, value: state.accounts },
        { filePath: files.audit, value: state.audit }
      ]);
      return publicAccount(account);
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
      const actor = ensureOwner(state, actorUsername);
      if (!isValidUsername(subject)) throw storeError('Invalid subject username');
      if (!CAPABILITIES.has(capability)) throw storeError('Invalid capability');
      if (!isValidScope(scope)) throw storeError('Invalid scope');
      const subjectAccount = findAccount(state.accounts, subject);
      if (!subjectAccount || !subjectAccount.active) throw storeError('Subject must be an active account');
      if (state.grants.some(item => item.subject === subject && item.capability === capability && item.scope === scope)) {
        throw storeError('Grant already exists', 'CONFLICT');
      }
      const created = { id: crypto.randomUUID(), at: new Date().toISOString(), actor: actor.username, subject, capability, scope };
      state.grants.push(created);
      appendAuditToState(state, actor.username, 'grant.created', subject, null, publicGrant(created));
      writeTransaction([
        { filePath: files.grants, value: state.grants },
        { filePath: files.audit, value: state.audit }
      ]);
      return clone(created);
    });
  }

  function revokeGrant(actorUsername, id) {
    if (!isValidId(id)) throw storeError('Invalid grant id');
    return withStoreLock(() => {
      const state = readStateUnsafe();
      const actor = ensureOwner(state, actorUsername);
      const index = state.grants.findIndex(grant => grant.id === id);
      if (index === -1) throw storeError('Grant not found', 'NOT_FOUND');
      const [removed] = state.grants.splice(index, 1);
      appendAuditToState(state, actor.username, 'grant.revoked', removed.subject, publicGrant(removed), null);
      writeTransaction([
        { filePath: files.grants, value: state.grants },
        { filePath: files.audit, value: state.audit }
      ]);
      return publicGrant(removed);
    });
  }

  function appendAudit(actorUsername, action, target, before, after) {
    return withStoreLock(() => {
      const state = readStateUnsafe();
      ensureOwner(state, actorUsername);
      const entry = appendAuditToState(state, actorUsername, action, target, before, after);
      writeTransaction([{ filePath: files.audit, value: state.audit }]);
      return publicAudit(entry);
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
    createAccount,
    submitApplication,
    getApplication,
    getApplicationStatus,
    listApplications,
    approveApplication,
    rejectApplication,
    withdrawApplication,
    setOwner,
    setActive,
    resetPassword,
    effectivePermissions: accountOrUsername => {
      const username = typeof accountOrUsername === 'string' ? accountOrUsername : accountOrUsername?.username;
      return withStoreLock(() => {
        const state = readStateUnsafe();
        return effectivePermissions(findAccount(state.accounts, username), state.grants);
      });
    },
    can,
    grant,
    revokeGrant,
    listGrants,
    appendAudit,
    listAudit: () => withStoreLock(() => readStateUnsafe().audit.map(publicAudit)),
    files: { ...files }
  };
}

module.exports = { createAccountStore, CAPABILITIES, effectivePermissions };
