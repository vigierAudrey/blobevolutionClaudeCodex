import { Buffer } from 'buffer';
import { createActorRef } from '../log-context';
import { sanitizeLogString, serializeLogValue } from '../log-serializer';

describe('log serializer', () => {
  it('redacts forbidden secrets and pii keys', () => {
    const serialized = serializeLogValue({
      password: 'secret-pass',
      token: 'abc123',
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      authorization: 'Bearer top-secret',
      cookie: 'sid=123',
      email: 'user@example.com',
      ip: '192.168.1.10',
      userId: 'user-123',
      targetUserId: 'user-456',
      emailHash: 'still-allowed',
      ipHash: 'still-allowed',
    }) as Record<string, unknown>;

    expect(serialized.password).toBe('[REDACTED]');
    expect(serialized.token).toBe('[REDACTED]');
    expect(serialized.accessToken).toBe('[REDACTED]');
    expect(serialized.refreshToken).toBe('[REDACTED]');
    expect(serialized.authorization).toBe('[REDACTED]');
    expect(serialized.cookie).toBe('[REDACTED]');
    expect(serialized.email).toBe('[REDACTED]');
    expect(serialized.ip).toBe('[REDACTED]');
    expect(serialized.userId).toBe(createActorRef('user-123'));
    expect(serialized.targetUserId).toBe(createActorRef('user-456'));
    expect(serialized.emailHash).toBe('still-allowed');
    expect(serialized.ipHash).toBe('still-allowed');
  });

  it('neutralizes control chars and inline secrets in strings', () => {
    const sanitized = sanitizeLogString(
      'header=Bearer abc123\r\nemail=user@example.com\tip=192.168.1.10 ipv6=2001:db8::1\0done',
    );

    expect(sanitized).not.toContain('\r');
    expect(sanitized).not.toContain('\n');
    expect(sanitized).not.toContain('\t');
    expect(sanitized).not.toContain('\0');
    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).not.toContain('user@example.com');
    expect(sanitized).not.toContain('192.168.1.10');
    expect(sanitized).not.toContain('2001:db8::1');
    expect(sanitized).toContain('[REDACTED_IP]');
  });

  it('redacts inline ipv6 addresses in error messages', () => {
    const serialized = serializeLogValue(
      new Error('connect failed for [2001:db8::1] and fallback 2001:db8:85a3::8a2e:370:7334'),
    ) as Record<string, unknown>;

    expect((serialized.message as string)).toContain('[REDACTED_IP]');
    expect((serialized.message as string)).not.toContain('2001:db8::1');
    expect((serialized.message as string)).not.toContain('2001:db8:85a3::8a2e:370:7334');
  });

  it('handles cyclic objects without throwing', () => {
    const value: Record<string, unknown> = { label: 'root' };
    value.self = value;

    const serialized = serializeLogValue(value) as Record<string, unknown>;

    expect(serialized.label).toBe('root');
    expect(serialized.self).toBe('[Circular]');
  });

  it('bounds deep objects, arrays and buffers', () => {
    const serialized = serializeLogValue({
      list: Array.from({ length: 30 }, (_, index) => index),
      payload: 'x'.repeat(700),
      buffer: Buffer.from('abcdef', 'utf8'),
      nested: {
        one: {
          two: {
            three: {
              four: {
                five: {
                  six: 'too-deep',
                },
              },
            },
          },
        },
      },
    }) as Record<string, unknown>;

    expect((serialized.list as unknown[]).length).toBeLessThanOrEqual(21);
    expect(serialized.payload).toContain('[Truncated]');
    expect(serialized.buffer).toMatchObject({
      type: 'Buffer',
      byteLength: 6,
    });
    expect(
      (((serialized.nested as Record<string, unknown>).one as Record<string, unknown>).two as Record<string, unknown>)
        .three,
    ).toEqual({ four: '[Truncated]' });
  });

  it('protects against getters and header poisoning', () => {
    const headers = Object.create(null) as Record<string, unknown>;
    headers.authorization = 'Bearer secret';
    headers.cookie = 'sid=123';
    headers['x-forwarded-for'] = '203.0.113.9';

    const exotic = {};
    Object.defineProperty(exotic, 'danger', {
      enumerable: true,
      get() {
        throw new Error('getter should not execute');
      },
    });

    const serialized = serializeLogValue({
      headers,
      exotic,
    }) as Record<string, unknown>;

    expect((serialized.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect((serialized.headers as Record<string, unknown>).cookie).toBe('[REDACTED]');
    expect((serialized.headers as Record<string, unknown>)['x-forwarded-for']).toBe('[REDACTED]');
    expect((serialized.exotic as Record<string, unknown>).danger).toBe('[Getter]');
  });
});
