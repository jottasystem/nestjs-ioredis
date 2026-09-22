import { DynamicModule, Global, Inject, Logger, Module, OnApplicationShutdown, Optional } from '@nestjs/common';
import { Cluster, ClusterNode, ClusterOptions } from 'ioredis';
import { RedisCluster } from './redis.cluster';

const DEFAULT_NODES = 'redis://localhost:6379';

function parseNodesFromEnv(): ClusterNode[] {
  return (process.env.REDIS || DEFAULT_NODES)
    .split(',')
    .map((node) => node.trim())
    .filter((node) => node.length > 0);
}

function usesTls(nodes: ClusterNode[]): boolean {
  return nodes.some((node) => typeof node === 'string' && node.startsWith('rediss://'));
}

export function buildClusterOptions(nodes: ClusterNode[], options?: ClusterOptions): ClusterOptions {
  const merged: ClusterOptions = {
    scaleReads: 'all',
    ...options,
  };

  // ioredis does not enable TLS from a rediss:// cluster node URL by itself.
  // ElastiCache in-transit encryption also needs hostname-preserving DNS lookup
  // so certificate verification matches the node hostnames.
  if (usesTls(nodes)) {
    merged.redisOptions = { tls: {}, ...merged.redisOptions };
    merged.dnsLookup = merged.dnsLookup ?? ((address, callback) => callback(null, address));
  }

  return merged;
}

@Global()
@Module({})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Optional() @Inject(RedisCluster) private readonly cluster?: RedisCluster) {}

  static forRoot(nodes?: ClusterNode[], options?: ClusterOptions): DynamicModule {
    const startupNodes = nodes && nodes.length > 0 ? nodes : parseNodesFromEnv();
    const clusterOptions = buildClusterOptions(startupNodes, options);

    return {
      module: RedisModule,
      providers: [
        {
          provide: RedisCluster,
          useFactory: async (): Promise<RedisCluster> => {
            const cluster = new Cluster(startupNodes, clusterOptions);
            await cluster.ping();
            return cluster;
          },
        },
      ],
      exports: [RedisCluster],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.cluster) {
      return;
    }
    try {
      await this.cluster.quit();
    } catch (error) {
      this.logger.warn(`Failed to close redis cluster gracefully: ${(error as Error).message}`);
      this.cluster.disconnect();
    }
  }
}
