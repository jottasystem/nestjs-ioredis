import { DynamicModule, Global, Module } from '@nestjs/common';
import { RedisCluster } from './redis.cluster';
import Redis, { ClusterNode, ClusterOptions } from 'ioredis';

@Global()
@Module({})
export class RedisModule {
  static forRoot(nodes?: ClusterNode[], options?: ClusterOptions): DynamicModule {
    if (!nodes) {
      nodes = (process.env.REDIS || 'redis://localhost:6379').split(',');
    }
    options = {
      scaleReads: 'all',
      ...options,
    };

    return {
      module: RedisModule,
      providers: [
        {
          provide: RedisCluster,
          useFactory: async () => {
            const cluster = new Redis.Cluster(nodes, options);

            await cluster.set('test', 'value');
            await cluster.get('test');
            await cluster.del('test');

            return cluster;
          },
        },
      ],
      exports: [RedisCluster],
    };
  }
}
