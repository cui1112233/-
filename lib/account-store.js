const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { USERS, PRIMARY_USER } = require('./shared');
const { readJson, writeJsonAtomic } = require('./system-store');

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const SCOPE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const CAPABILITIES = new Set(['account:review', 'preset:draft', 'preset:publish']);

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function isValidScope(scope) {
  return scope === '*' || (typeof scope === 'string' && SCOPE_PATTERN.test(scope));
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
  if (typeof passwordHash !== 'string' || typeof password !== 'string') return false;

  const parts = passwordHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const [saltHex, expectedHex] = parts.slice(1);
  if (!/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicAccount(account) {
  if (!account) return null;
  const { passwordHash, ...safeAccount } = account;
  return { ...safeAccount };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeAuditValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'passwordHash')
      .map(([key, item]) => [key, sanitizeAuditValue(item)])
  );
}

function effectivePermissions(account, grants) {
  if (!account) return [];
  if (account.isOwner) return [{ capability: '*', scope: '*' }];
  return (Array.isArray(grants) ? grants : [])
    .filter(grant => grant.subject === account.username)
    .map(grant => ({ capability: grant.capability, scope: grant.scope }));
}

function createAccountStore({ systemDir }) {
  if (typeof systemDir !== 'string' || systemDir.length === 0) {
    throw new Error('systemDir is required');
  }

  const files = {
    accounts: path.join(systemDir, 'accounts.json'),
    applications: path.join(systemDir, 'applications.json'),
    grants: path.join(systemDir, 'grants.json'),
    audit: path.join(systemDir, 'audit.json')
  };

  function readAccounts() {
    const accounts = readJson(files.accounts, []);
    return Array.isArray(accounts) ? accounts : [];
  }

  function readGrants() {
    const grants = readJson(files.grants, []);
    return Array.isArray(grants) ? grants : [];
  }

  function readAudit() {
    const audit = readJson(files.audit, []);
    return Array.isArray(audit) ? audit : [];
  }

  function findAccount(username) {
    if (!isValidUsername(username)) return null;
    return readAccounts().find(account => account.username === username) || null;
  }

  function appendAudit(actor, action, target, before, after) {
    const audit = readAudit();
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      target,
      before: sanitizeAuditValue(before),
      after: sanitizeAuditValue(after)
    };
    audit.push(entry);
    writeJsonAtomic(files.audit, audit);
    return clone(entry);
  }

  function ensureSeedAccounts(seedUsers = USERS) {
    if (fs.existsSync(files.accounts)) return false;
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

    writeJsonAtomic(files.accounts, accounts);
    return true;
  }

  function getAccount(username) {
    return publicAccount(findAccount(username));
  }

  function getInternalAccount(username) {
    const account = findAccount(username);
    return account ? clone(account) : null;
  }

  function listAccounts() {
    return readAccounts().map(publicAccount);
  }

  function verifyPassword(username, password) {
    const account = findAccount(username);
    return Boolean(account && matchesPassword(account.passwordHash, password));
  }

  function setOwner(username) {
    const account = findAccount(username);
    if (!account || username !== PRIMARY_USER || !account.isOwner) {
      throw new Error('owner is immutable');
    }
    throw new Error('owner is immutable');
  }

  function setActive(username, active) {
    if (!isValidUsername(username)) throw new Error('Invalid username');
    if (typeof active !== 'boolean') throw new Error('Active status must be boolean');

    const accounts = readAccounts();
    const index = accounts.findIndex(account => account.username === username);
    if (index === -1) throw new Error('Account not found');

    accounts[index] = {
      ...accounts[index],
      active,
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(files.accounts, accounts);
    return publicAccount(accounts[index]);
  }

  function listGrants(subject) {
    if (subject !== undefined && !isValidUsername(subject)) return [];
    return readGrants()
      .filter(grant => subject === undefined || grant.subject === subject)
      .map(clone);
  }

  function grant(actorUsername, subject, { capability, scope } = {}) {
    const actor = findAccount(actorUsername);
    if (!actor || !actor.active || !actor.isOwner) throw new Error('Actor must be an active owner');
    if (!isValidUsername(subject)) throw new Error('Invalid subject username');
    if (!CAPABILITIES.has(capability)) throw new Error('Invalid capability');
    if (!isValidScope(scope)) throw new Error('Invalid scope');

    const subjectAccount = findAccount(subject);
    if (!subjectAccount || !subjectAccount.active) throw new Error('Subject must be an active account');

    const grants = readGrants();
    if (grants.some(grantItem => grantItem.subject === subject && grantItem.capability === capability && grantItem.scope === scope)) {
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
    grants.push(created);
    writeJsonAtomic(files.grants, grants);
    appendAudit(actor.username, 'grant.created', subject, null, created);
    return clone(created);
  }

  function can(accountOrUsername, capability, scope) {
    if (!CAPABILITIES.has(capability) || !isValidScope(scope)) return false;
    const username = typeof accountOrUsername === 'string' ? accountOrUsername : accountOrUsername?.username;
    const account = findAccount(username);
    if (!account || !account.active) return false;

    return effectivePermissions(account, readGrants())
      .some(permission => (permission.capability === '*' || permission.capability === capability)
        && (permission.scope === '*' || permission.scope === scope));
  }

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
      const account = findAccount(username);
      return effectivePermissions(account, readGrants());
    },
    can,
    grant,
    listGrants,
    listAudit: () => readAudit().map(entry => sanitizeAuditValue(clone(entry))),
    files: { ...files }
  };
}

module.exports = { createAccountStore, CAPABILITIES, effectivePermissions };
