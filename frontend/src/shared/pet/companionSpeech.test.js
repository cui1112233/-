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

test('classifies the four configured greeting periods only', () => {
  assert.equal(getGreetingPeriod(new Date('2026-08-15T09:00:00')), 'morning');
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
  const first = getCompanionCandidate({ now, username: 'writer', storage: local, random: () => 0, active: true, visible: true, chatOpen: false, asking: false, dragging: false });
  assert.equal(first.kind, 'welcome');
  const greeting = getCompanionCandidate({ now, username: 'writer', storage: local, random: () => 0, active: true, visible: true, chatOpen: false, asking: false, dragging: false });
  assert.equal(greeting.kind, 'greeting');
  assert.equal(getCompanionCandidate({ now, username: 'writer', storage: local, random: () => 0, active: true, visible: false, chatOpen: false, asking: false, dragging: false }), null);
  assert.equal(readCompanionSpeechState('writer', local).greetings['2026-08-15:morning'], true);
});

test('uses per-account state and degrades when storage fails', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => readCompanionSpeechState('writer', broken));
  assert.notEqual(COMPANION_SPEECH_PRIORITY.error, COMPANION_SPEECH_PRIORITY.idle);
});
