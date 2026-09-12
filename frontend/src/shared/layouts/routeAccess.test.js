import test from 'node:test';
import assert from 'node:assert/strict';

import { getRouteAccessState, shouldPromptLoginForApiFailure } from './routeAccess.js';

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

test('only an explicitly classified primary-session failure opens the login flow', () => {
  assert.equal(shouldPromptLoginForApiFailure({ status: 401, sessionAuthFailure: true }), true);
  assert.equal(shouldPromptLoginForApiFailure({ status: 401 }), false);
  assert.equal(shouldPromptLoginForApiFailure({ status: 503, sessionAuthFailure: true }), false);
});
