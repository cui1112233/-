import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPANION_SPEECH_PRIORITY,
  getCompanionCandidate,
  getGreetingPeriod,
  nextIdleSpeechAt,
  pickSpeech,
  readCompanionSpeechState
} from './companionSpeech.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

function candidateOptions(overrides = {}) {
  return {
    now: new Date('2026-08-15T09:00:00'),
    username: 'writer',
    storage: storage(),
    random: () => 0,
    active: true,
    visible: true,
    chatOpen: false,
    asking: false,
    dragging: false,
    ...overrides
  };
}

test('classifies the four configured greeting periods only', () => {
  assert.equal(getGreetingPeriod(new Date('2026-08-15T08:00:00')), 'morning');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T09:00:00')), 'morning');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T10:30:00')), 'morning');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T10:31:00')), null);
  assert.equal(getGreetingPeriod(new Date('2026-08-15T12:00:00')), 'midday');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T15:00:00')), 'afternoon');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T20:00:00')), 'evening');
  assert.equal(getGreetingPeriod(new Date('2026-08-15T23:00:00')), null);
});

test('schedules idle speech from 45 to 90 minutes', () => {
  assert.equal(nextIdleSpeechAt(1000, () => 0), 2701000);
  assert.equal(nextIdleSpeechAt(1000, () => 0.999999), 5400998);
});

test('does not choose the previous idle sentence when another line exists', () => {
  assert.equal(pickSpeech(['a', 'b'], 0, () => 0), 'b');
});

test('shows each daily greeting once and skips proactive speech when ineligible', () => {
  const local = storage();
  const now = new Date('2026-08-15T09:00:00');
  const first = getCompanionCandidate(candidateOptions({ now, storage: local }));
  assert.equal(first.kind, 'welcome');
  const greeting = getCompanionCandidate(candidateOptions({ now, storage: local }));
  assert.equal(greeting.kind, 'greeting');
  assert.equal(getCompanionCandidate(candidateOptions({ now, storage: local, visible: false })), null);
  assert.equal(readCompanionSpeechState('writer', local).greetings['2026-08-15:morning'], true);
});

test('schedules idle after welcome so it does not immediately interrupt outside greeting hours', () => {
  const local = storage();
  const now = new Date('2026-08-15T23:00:00');
  const first = getCompanionCandidate(candidateOptions({ now, username: 'welcome-writer', storage: local }));

  assert.equal(first.kind, 'welcome');
  assert.equal(readCompanionSpeechState('welcome-writer', local).nextIdleAt, now.getTime() + 2700000);
  assert.equal(getCompanionCandidate(candidateOptions({ now, username: 'welcome-writer', storage: local })), null);
});

test('reschedules idle when companion speech is re-enabled', () => {
  const local = storage();
  const beforeDisable = new Date('2026-08-15T23:00:00');
  getCompanionCandidate(candidateOptions({ now: beforeDisable, storage: local }));
  getCompanionCandidate(candidateOptions({ now: new Date('2026-08-15T23:50:00'), storage: local, active: false }));
  const resumedAt = new Date('2026-08-16T02:00:00');

  assert.equal(getCompanionCandidate(candidateOptions({ now: resumedAt, storage: local, active: true })), null);
  assert.equal(readCompanionSpeechState('writer', local).nextIdleAt, resumedAt.getTime() + 2700000);
});

test('reschedules an expired idle when eligibility is restored', () => {
  const local = storage();
  const beforeIneligible = new Date('2026-08-15T23:00:00');
  getCompanionCandidate(candidateOptions({ now: beforeIneligible, username: 'ineligible-writer', storage: local }));
  const ineligibleAt = new Date('2026-08-16T02:00:00');
  getCompanionCandidate(candidateOptions({ now: ineligibleAt, username: 'ineligible-writer', storage: local, visible: false }));

  assert.equal(getCompanionCandidate(candidateOptions({ now: ineligibleAt, username: 'ineligible-writer', storage: local })), null);
  assert.equal(readCompanionSpeechState('ineligible-writer', local).nextIdleAt, ineligibleAt.getTime() + 2700000);
});

test('keeps companion state isolated between usernames', () => {
  const local = storage();
  const now = new Date('2026-08-15T23:00:00');
  const alice = getCompanionCandidate(candidateOptions({ now, username: 'alice', storage: local, active: false }));
  const bob = getCompanionCandidate(candidateOptions({ now, username: 'bob', storage: local }));

  assert.equal(alice, null);
  assert.equal(bob.kind, 'welcome');
  assert.equal(readCompanionSpeechState('alice', local).active, false);
  assert.equal(readCompanionSpeechState('bob', local).active, true);
});

test('uses per-account state and degrades when storage fails', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => readCompanionSpeechState('writer', broken));
  assert.notEqual(COMPANION_SPEECH_PRIORITY.error, COMPANION_SPEECH_PRIORITY.idle);
});
