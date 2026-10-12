import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

describe('fallback error handler', () => {
  it('hides the message of an unexpected 5xx', async () => {
    const app = await buildApp({ config });
    app.get('/__boom', async () => {
      throw new Error('select * from secrets: password=hunter2');
    });
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'internal_error', message: 'Internal error' });
    await app.close();
  });

  it('keeps the message of a 4xx', async () => {
    const app = await buildApp({ config });
    app.get('/__bad', async () => {
      throw Object.assign(new Error('Bad thing'), { statusCode: 400 });
    });
    const res = await app.inject({ method: 'GET', url: '/__bad' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Bad thing');
    await app.close();
  });
});
