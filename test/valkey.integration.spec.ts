import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisCluster, RedisModule, RedisStringCache } from '../src';
import { startValkeyCluster, ValkeyContainer } from './valkey-container';

describe('RedisModule against Valkey (docker)', () => {
  let valkey: ValkeyContainer;
  let app: TestingModule;
  let cluster: RedisCluster;
  let cache: RedisStringCache<{ id: number; name: string }>;

  beforeAll(async () => {
    valkey = await startValkeyCluster();

    app = await Test.createTestingModule({
      imports: [RedisModule.forRoot([valkey.url])],
      providers: [RedisStringCache.register({ keyPrefix: 'it' })],
    }).compile();
    app.enableShutdownHooks();
    await app.init();

    cluster = app.get(RedisCluster);
    cache = app.get(RedisStringCache);
  });

  afterAll(async () => {
    await app?.close();
    valkey?.stop();
  });

  it('connects to a Valkey >= 7.2 cluster', () => {
    const [major, minor] = valkey.version.split('.').map(Number);
    expect(major > 7 || (major === 7 && minor >= 2)).toBe(true);
    expect(cluster.status).toBe('ready');
  });

  it('sets and reads a raw string through the injected cluster', async () => {
    await cluster.set('it:raw', 'value', 'EX', 30);
    await expect(cluster.get('it:raw')).resolves.toBe('value');
    await expect(cluster.ttl('it:raw')).resolves.toBeGreaterThan(0);
  });

  it('round-trips an object through RedisStringCache with ttl', async () => {
    await cache.set('user:1', { id: 1, name: 'valkey' }, 60);

    await expect(cache.get('user:1')).resolves.toEqual({ id: 1, name: 'valkey' });
    await expect(cluster.ttl('it:user:1')).resolves.toBeGreaterThan(0);
  });

  it('stores without expiry when ttl is 0', async () => {
    await cache.set('user:2', { id: 2, name: 'forever' }, 0);

    await expect(cluster.ttl('it:user:2')).resolves.toBe(-1);
  });

  it('returns null for a missing key and after remove', async () => {
    await expect(cache.get('missing')).resolves.toBeNull();

    await cache.set('user:3', { id: 3, name: 'gone' }, 60);
    await cache.remove('user:3');
    await expect(cache.get('user:3')).resolves.toBeNull();
    await expect(cluster.exists('it:user:3')).resolves.toBe(0);
  });

  it('removes the exact prefixed key when the payload cannot be deserialized', async () => {
    await cluster.set('it:corrupt', 'not-flatted-json{');

    await expect(cache.get('corrupt')).resolves.toBeNull();
    await expect(cluster.exists('it:corrupt')).resolves.toBe(0);
  });
});
