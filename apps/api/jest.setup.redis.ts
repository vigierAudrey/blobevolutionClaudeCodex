import { jest } from '@jest/globals';

const createRedisClientMock = () => ({
  connect: jest.fn(async () => undefined),
  quit: jest.fn(async () => undefined),
  on: jest.fn(),
  ping: jest.fn(async () => 'PONG'),
  get: jest.fn(async () => null),
  set: jest.fn(async () => 'OK'),
  setEx: jest.fn(async () => 'OK'),
  del: jest.fn(async () => 0),
  keys: jest.fn(async () => []),
  incr: jest.fn(async () => 1),
  sAdd: jest.fn(async () => 1),
  sMembers: jest.fn(async () => []),
  expire: jest.fn(async () => 1),
  unlink: jest.fn(async () => 0),
  scan: jest.fn(async () => ({ cursor: 0, keys: [] })),
  eval: jest.fn(async () => 'VALID'), // Lua script execution (default: success)
  sendCommand: jest.fn(async () => null),
}) as any;

const redisMock = {
  instances: [] as any[],
  createClient: jest.fn(() => {
    const client = createRedisClientMock();
    redisMock.instances.push(client);
    return client;
  }),
  factory: createRedisClientMock,
};

jest.mock('redis', () => ({
  __esModule: true,
  createClient: redisMock.createClient,
}));

// Expose mock for test files that need fine-grained control
(globalThis as any).__REDIS_MOCK__ = redisMock;

// Provide a minimal ioredis mock for modules that rely on it
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(async () => undefined),
    quit: jest.fn(async () => undefined),
    on: jest.fn(),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
  }));
}, { virtual: true });
