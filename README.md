# @raphaabreu/nestjs-ioredis

NestJS module exposing an [ioredis](https://github.com/redis/ioredis) `Cluster` client, plus a small
JSON string cache. Works with Redis and Valkey clusters, including Amazon ElastiCache.

## Requirements

| Dependency       | Supported            | Tested            |
| ---------------- | -------------------- | ----------------- |
| Node.js          | >= 20                | 26                |
| `@nestjs/common` | >= 8 (peer)          | 10, 11, 12        |
| `ioredis`        | >= 5 (peer)          | 5.11, 6.0         |
| Server           | Redis >= 6, Valkey >= 7.2 (cluster mode) | Valkey 9.1 |

`ioredis` and `@nestjs/common` are peer dependencies so your app controls the version. ioredis 6 talks
RESP3 by default; pass `redisOptions: { protocol: 2 }` if any of your own code depends on RESP2 reply
shapes.

## Usage

```ts
import { Module } from '@nestjs/common';
import { RedisModule, RedisStringCache } from '@raphaabreu/nestjs-ioredis';

@Module({
  imports: [RedisModule.forRoot()],
  providers: [RedisStringCache.register({ keyPrefix: 'users' })],
})
export class AppModule {}
```

`RedisModule.forRoot(nodes?, options?)`:

- `nodes` defaults to `process.env.REDIS` (comma-separated URLs), falling back to `redis://localhost:6379`.
- `options` are ioredis `ClusterOptions`; the module defaults `scaleReads: 'all'`.
- The module is `@Global()`; inject `RedisCluster` anywhere. It pings the cluster on boot and calls
  `quit()` on application shutdown (enable Nest shutdown hooks).

```ts
constructor(private readonly redis: RedisCluster, private readonly cache: RedisStringCache<User>) {}

await this.cache.set('42', user, 60); // ttl seconds, 0 = no expiry
const user = await this.cache.get('42');
await this.cache.remove('42');
```

### Amazon ElastiCache (Valkey / Redis OSS) with in-transit encryption

Use `rediss://` URLs. The module then enables TLS and a hostname-preserving `dnsLookup`, which
ElastiCache cluster mode needs for certificate validation:

```
REDIS=rediss://clustercfg.my-cache.abc123.use1.cache.amazonaws.com:6379
```

Any `redisOptions.tls` / `dnsLookup` you pass explicitly wins over these defaults. Cluster-mode-disabled
ElastiCache endpoints are not supported (the client is always `Cluster`).

## Development

```
npm run lint
npm run typecheck
npm test          # starts a Valkey cluster in Docker (VALKEY_IMAGE, default valkey/valkey:9.1)
npm run build
```
