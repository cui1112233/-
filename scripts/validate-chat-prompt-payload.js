#!/usr/bin/env node

const assert = require('assert');
const chatRouter = require('../routes/chat');

if (!chatRouter._private || typeof chatRouter._private.buildScriptMessages !== 'function') {
  throw new Error('routes/chat.js must expose _private.buildScriptMessages for validation');
}

const messages = chatRouter._private.buildScriptMessages({
  promptType: 'script',
  mode: 'continuous',
  format: 'storyboard',
  duration: '10s',
  novelText: '测试小说',
  characters: [{ name: '阿明', role: '主角' }],
  scenes: [{ location: '码头', event: '重逢' }]
});

const userContent = messages.find(message => message.role === 'user').content;
assert(!userContent.includes('[object Object]'), 'structured prompt payload must not become [object Object]');
assert(userContent.includes('"name": "阿明"'), 'characters should be serialized as JSON');
assert(userContent.includes('"location": "码头"'), 'scenes should be serialized as JSON');

console.log('Chat prompt payload validation passed.');
