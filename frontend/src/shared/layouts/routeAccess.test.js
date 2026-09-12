import test from 'node:test';
import assert from 'node:assert/strict';

import { getRouteAccessState } from './routeAccess.js';

test('anonymous Shuihuo access prompts for login without discarding its route', () => {
  assert.deepEqual(getRouteAccessState({ pathname: '/shuihuo-production', isLoggedIn: false }), {
    canRenderPage: false,
    shouldPromptLogin: true
  });
});

test('logging in makes the originally requested Shuihuo route available', () => {
  assert.deepEqual(getRouteAccessState({ pathname: '/shuihuo-production', isLoggedIn: true }), {
    canRenderPage: true,
    shouldPromptLogin: false
  });
});

test('anonymous home access remains public', () => {
  assert.deepEqual(getRouteAccessState({ pathname: '/', isLoggedIn: false }), {
    canRenderPage: true,
    shouldPromptLogin: false
  });
});
