import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4100';
const PASSWORD = __ENV.ACTIVE_TEST_PASSWORD || 'Passw0rd!';
const OPEN_TARGET_USER_ID = __ENV.ACTIVE_TEST_OPEN_TARGET_USER_ID || '';
const DEBUG_FAILURES = String(__ENV.ACTIVE_LOAD_DEBUG || '').toLowerCase() === 'true';
const USERS = (__ENV.ACTIVE_TEST_USERS || 'dev+active-rider-a@test.com,dev+active-rider-b@test.com,dev+active-rider-c@test.com')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const LOGIN_USERS = (__ENV.ACTIVE_TEST_LOGIN_USERS || USERS.slice(0, 2).join(','))
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const MATCHING_USERS = (__ENV.ACTIVE_TEST_MATCHING_USERS || __ENV.ACTIVE_TEST_MATCHING_USER || USERS.join(','))
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const OPEN_USERS = (__ENV.ACTIVE_TEST_OPEN_USERS || __ENV.ACTIVE_TEST_OPEN_USER || USERS.join(','))
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const MESSAGE_USERS = (__ENV.ACTIVE_TEST_MESSAGE_USERS || __ENV.ACTIVE_TEST_MESSAGE_USER || USERS.join(','))
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value == null ? '' : value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readDuration(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

const LOGIN_START_TIME = readDuration(__ENV.ACTIVE_LOAD_LOGIN_START_TIME, '46s');
const LOGIN_VUS = readPositiveInt(__ENV.ACTIVE_LOAD_LOGIN_VUS, 1);
const LOGIN_ITERATIONS = readPositiveInt(__ENV.ACTIVE_LOAD_LOGIN_ITERATIONS, 2);
const LOGIN_MAX_DURATION = readDuration(__ENV.ACTIVE_LOAD_LOGIN_MAX_DURATION, '1m');
const MATCHING_VUS = readPositiveInt(__ENV.ACTIVE_LOAD_MATCHING_VUS, 1);
const MATCHING_DURATION = readDuration(__ENV.ACTIVE_LOAD_MATCHING_DURATION, '45s');
const MATCHING_SLEEP_SECONDS = readPositiveNumber(__ENV.ACTIVE_LOAD_MATCHING_SLEEP_SECONDS, 4);
const OPEN_CONVERSATION_VUS = readPositiveInt(__ENV.ACTIVE_LOAD_OPEN_VUS, 1);
const OPEN_CONVERSATION_DURATION = readDuration(__ENV.ACTIVE_LOAD_OPEN_DURATION, '35s');
const OPEN_CONVERSATION_SLEEP_SECONDS = readPositiveNumber(__ENV.ACTIVE_LOAD_OPEN_SLEEP_SECONDS, 8);
const MESSAGE_VUS = readPositiveInt(__ENV.ACTIVE_LOAD_MESSAGE_VUS, 1);
const MESSAGE_DURATION = readDuration(__ENV.ACTIVE_LOAD_MESSAGE_DURATION, '35s');
const MESSAGE_SLEEP_SECONDS = readPositiveNumber(__ENV.ACTIVE_LOAD_MESSAGE_SLEEP_SECONDS, 7);

if (!OPEN_TARGET_USER_ID) {
  throw new Error('ACTIVE_TEST_OPEN_TARGET_USER_ID is required');
}

function createActionMetrics(prefix) {
  return {
    attempts: new Counter(`active_${prefix}_attempts`),
    errors: new Counter(`active_${prefix}_errors`),
    duration: new Trend(`active_${prefix}_duration`, true),
    status401: new Counter(`active_${prefix}_401`),
    status403: new Counter(`active_${prefix}_403`),
    status429: new Counter(`active_${prefix}_429`),
    status5xx: new Counter(`active_${prefix}_5xx`),
  };
}

const loginMetrics = createActionMetrics('login');
const matchingMetrics = createActionMetrics('matching');
const openConversationMetrics = createActionMetrics('open_conversation');
const messageMetrics = createActionMetrics('message');

const csrfFetches = new Counter('active_csrf_fetches');
const csrfDuration = new Trend('active_csrf_duration', true);

const sessionState = {
  authenticated: false,
  email: null,
  csrfToken: null,
  directConversationId: null,
};
const loggedFailures = {};

export const options = {
  noCookiesReset: true,
  scenarios: {
    login_probe: {
      executor: 'shared-iterations',
      exec: 'loginProbe',
      startTime: LOGIN_START_TIME,
      vus: LOGIN_VUS,
      iterations: LOGIN_ITERATIONS,
      maxDuration: LOGIN_MAX_DURATION,
    },
    matching_steady: {
      executor: 'constant-vus',
      exec: 'matchingSteady',
      vus: MATCHING_VUS,
      duration: MATCHING_DURATION,
    },
    open_conversation_steady: {
      executor: 'constant-vus',
      exec: 'openConversationSteady',
      vus: OPEN_CONVERSATION_VUS,
      duration: OPEN_CONVERSATION_DURATION,
    },
    send_message_steady: {
      executor: 'constant-vus',
      exec: 'sendMessageSteady',
      vus: MESSAGE_VUS,
      duration: MESSAGE_DURATION,
    },
  },
  thresholds: {
    active_login_duration: ['p(95)<1500'],
    active_matching_duration: ['p(95)<2500'],
    active_open_conversation_duration: ['p(95)<2500'],
    active_message_duration: ['p(95)<2500'],
  },
};

function pickLoginEmail() {
  return LOGIN_USERS[(__ITER + __VU - 1) % LOGIN_USERS.length];
}

function pickScenarioUser(entries, fallback = '') {
  return entries[(__VU - 1) % entries.length] || fallback || USERS[(__VU - 1) % USERS.length] || '';
}

function buildHeaders(csrfToken, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    'X-API-ENVELOPE': '1',
  };

  Object.keys(extra).forEach((key) => {
    headers[key] = extra[key];
  });

  return headers;
}

function markStatus(metrics, status) {
  if (status === 401) metrics.status401.add(1);
  if (status === 403) metrics.status403.add(1);
  if (status === 429) metrics.status429.add(1);
  if (status >= 500) metrics.status5xx.add(1);
  if (status >= 400) metrics.errors.add(1);
}

function maybeLogFailure(action, response) {
  if (!DEBUG_FAILURES || loggedFailures[action] || response.status < 400) {
    return;
  }

  loggedFailures[action] = true;
  const body = typeof response.body === 'string' ? response.body.slice(0, 300) : JSON.stringify(response.body).slice(0, 300);
  console.log(`[active-debug] ${action} status=${response.status} body=${body}`);
}

function randomUuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function parseJson(response) {
  if (!response || !response.body) {
    return null;
  }

  try {
    return response.json();
  } catch (error) {
    return null;
  }
}

function getEnvelopeData(payload) {
  if (payload && payload.data) {
    return payload.data;
  }

  return payload;
}

function fetchCsrfToken(record = true, force = false) {
  if (!force && sessionState.csrfToken) {
    return sessionState.csrfToken;
  }

  const response = http.get(`${BASE_URL}/csrf-token`, {
    timeout: '10s',
    tags: { action: 'csrf' },
  });

  if (record) {
    csrfFetches.add(1);
    csrfDuration.add(response.timings.duration);
  }

  check(response, {
    'csrf endpoint responds': (res) => res.status === 200,
  });

  if (response.status !== 200) {
    maybeLogFailure('csrf', response);
    sessionState.csrfToken = null;
    return null;
  }

  const payload = parseJson(response);
  sessionState.csrfToken = payload && typeof payload.csrfToken === 'string' ? payload.csrfToken : null;
  return sessionState.csrfToken;
}

function login(email, { record = true, force = false } = {}) {
  if (!force && sessionState.authenticated && sessionState.email === email && sessionState.csrfToken) {
    return { ok: true };
  }

  const csrfToken = fetchCsrfToken(record, force);
  if (!csrfToken) {
    sessionState.authenticated = false;
    sessionState.email = null;
    sessionState.directConversationId = null;
    return { ok: false };
  }

  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: PASSWORD, consentAccepted: true }),
    {
      headers: buildHeaders(csrfToken),
      timeout: '10s',
      tags: { action: 'login' },
    },
  );

  if (record) {
    loginMetrics.attempts.add(1);
    loginMetrics.duration.add(response.timings.duration);
    markStatus(loginMetrics, response.status);
  }

  check(response, {
    'login status acceptable': (res) => res.status === 200,
  });

  if (response.status !== 200) {
    maybeLogFailure('login', response);
    sessionState.authenticated = false;
    sessionState.email = null;
    sessionState.directConversationId = null;
    return { ok: false };
  }

  sessionState.authenticated = true;
  sessionState.email = email;
  sessionState.directConversationId = null;
  sessionState.csrfToken = fetchCsrfToken(false, true) || csrfToken;
  return { ok: true };
}

function ensureSession(email, record = false) {
  if (sessionState.authenticated && sessionState.email === email && sessionState.csrfToken) {
    return true;
  }

  return login(email, { record, force: true }).ok;
}

function matchingSearch(record = true) {
  const response = http.post(
    `${BASE_URL}/matching/search`,
    JSON.stringify({
      sport: 'surf',
      level: 'advanced',
      date: 'anytime',
      distanceKm: 10,
      location: { lat: 50.1234, lng: 1.2345 },
      limit: 10,
    }),
    {
      headers: buildHeaders(sessionState.csrfToken),
      timeout: '10s',
      tags: { action: 'matching' },
    },
  );

  if (record) {
    matchingMetrics.attempts.add(1);
    matchingMetrics.duration.add(response.timings.duration);
    markStatus(matchingMetrics, response.status);
  }

  check(response, {
    'matching search status acceptable': (res) => res.status === 200,
  });

  if (response.status !== 200) {
    maybeLogFailure('matching_search', response);
    return null;
  }

  const payload = parseJson(response);
  const data = getEnvelopeData(payload);
  const results = data && Array.isArray(data.results) ? data.results : [];
  return Array.isArray(results) ? results[0] || null : null;
}

function openConversation(record = true) {
  const response = http.post(
    `${BASE_URL}/conversations/open`,
    JSON.stringify({ targetUserId: OPEN_TARGET_USER_ID }),
    {
      headers: buildHeaders(sessionState.csrfToken),
      timeout: '10s',
      tags: { action: 'open_conversation' },
    },
  );

  if (record) {
    openConversationMetrics.attempts.add(1);
    openConversationMetrics.duration.add(response.timings.duration);
    markStatus(openConversationMetrics, response.status);
  }

  check(response, {
    'open conversation status acceptable': (res) => res.status === 200 || res.status === 201,
  });

  if (![200, 201].includes(response.status)) {
    maybeLogFailure('open_conversation', response);
    return null;
  }

  const payload = parseJson(response);
  const data = getEnvelopeData(payload);
  const conversationId = data && typeof data.id === 'string' ? data.id : null;
  if (conversationId) {
    sessionState.directConversationId = conversationId;
  }
  return conversationId;
}

function ensureDirectConversation() {
  if (sessionState.directConversationId) {
    return sessionState.directConversationId;
  }

  return openConversation(false);
}

function sendMessage(record = true) {
  const conversationId = ensureDirectConversation();
  if (!conversationId) {
    return false;
  }

  const response = http.post(
    `${BASE_URL}/conversations/${conversationId}/messages`,
    JSON.stringify({
      type: 'TEXT',
      content: `k6-${__VU}-${__ITER}`,
      clientMsgId: randomUuidV4(),
    }),
    {
      headers: buildHeaders(sessionState.csrfToken),
      timeout: '10s',
      tags: { action: 'send_message' },
    },
  );

  if (record) {
    messageMetrics.attempts.add(1);
    messageMetrics.duration.add(response.timings.duration);
    markStatus(messageMetrics, response.status);
  }

  check(response, {
    'message status acceptable': (res) => res.status === 200 || res.status === 201,
  });

  maybeLogFailure('send_message', response);

  return response.status === 200 || response.status === 201;
}

export function loginProbe() {
  const email = pickLoginEmail();
  sessionState.authenticated = false;
  sessionState.email = null;
  sessionState.directConversationId = null;
  login(email, { record: true, force: true });
  sleep(1);
}

export function matchingSteady() {
  const email = pickScenarioUser(MATCHING_USERS);
  if (!ensureSession(email, false)) {
    sleep(2);
    return;
  }

  matchingSearch(true);
  sleep(MATCHING_SLEEP_SECONDS);
}

export function openConversationSteady() {
  const email = pickScenarioUser(OPEN_USERS);
  if (!ensureSession(email, false)) {
    sleep(2);
    return;
  }

  openConversation(true);
  sleep(OPEN_CONVERSATION_SLEEP_SECONDS);
}

export function sendMessageSteady() {
  const email = pickScenarioUser(MESSAGE_USERS);
  if (!ensureSession(email, false)) {
    sleep(2);
    return;
  }

  sendMessage(true);
  sleep(MESSAGE_SLEEP_SECONDS);
}
