import { Logger, Provider } from '@nestjs/common';
import { parse, stringify } from 'flatted';
import { RedisCluster } from './redis.cluster';

export type RedisStringCacheOptions<T = any> = {
  serializer?: (event: T | null) => string;
  deserializer?: (event: string) => T;

  keyPrefix?: string;

  getErrorBehavior?: 'throws' | 'returnsNull';
  deserializeErrorBehavior?: 'removes' | 'ignores';
  setErrorBehavior?: 'throws' | 'ignores';
};

const defaultOptions: Required<RedisStringCacheOptions> = {
  serializer: stringify,
  deserializer: parse,

  keyPrefix: '',

  getErrorBehavior: 'returnsNull',
  deserializeErrorBehavior: 'removes',
  setErrorBehavior: 'ignores',
};

export class RedisStringCache<T = any> {
  private readonly logger = new Logger(RedisStringCache.name);

  private readonly options: Required<RedisStringCacheOptions<T>>;

  constructor(
    private readonly redis: RedisCluster,
    options?: RedisStringCacheOptions<T>,
  ) {
    this.options = { ...defaultOptions, ...options } as Required<RedisStringCacheOptions<T>>;
  }

  static register<T>(options: RedisStringCacheOptions<T>): Provider {
    return {
      provide: RedisStringCache,
      inject: [RedisCluster],
      useFactory: (redisCluster: RedisCluster) => new RedisStringCache(redisCluster, options),
    };
  }

  async get(key: string): Promise<T | null> {
    const fullKey = this.getKey(key);
    let data: string | null;

    try {
      data = await this.redis.get(fullKey);
      if (data === null || data === undefined) {
        return null;
      }
    } catch (error) {
      this.logger.error(`Failed to get key ${fullKey} from cache`, (error as Error).stack);

      if (this.options.getErrorBehavior === 'returnsNull') {
        return null;
      }

      throw error;
    }

    try {
      return this.options.deserializer(data);
    } catch (error) {
      this.logger.error(
        `Failed to deserialize key ${fullKey} from cache with value ${truncate(data)}`,
        (error as Error).stack,
      );

      if (this.options.deserializeErrorBehavior === 'removes') {
        await this.remove(key);
      }
      if (this.options.getErrorBehavior === 'returnsNull') {
        return null;
      }

      throw error;
    }
  }

  async set(key: string, value: T | null, ttl: number): Promise<void> {
    const fullKey = this.getKey(key);

    let serializedValue: string;

    try {
      serializedValue = this.options.serializer(value);
    } catch (error) {
      this.logger.error(`Failed to serialize value for key ${fullKey}`, (error as Error).stack);

      if (this.options.setErrorBehavior === 'ignores') {
        return;
      }
      throw error;
    }

    try {
      if (ttl > 0) {
        await this.redis.setex(fullKey, ttl, serializedValue);
      } else {
        await this.redis.set(fullKey, serializedValue);
      }
    } catch (error) {
      this.logger.error(`Failed to set value for key ${fullKey}`, (error as Error).stack);

      if (this.options.setErrorBehavior === 'ignores') {
        return;
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.redis.del(this.getKey(key));
  }

  private getKey(key: string): string {
    const { keyPrefix } = this.options;
    return keyPrefix ? `${keyPrefix}:${key}` : key;
  }
}

function truncate(value: string, max = 100): string {
  return value.length > max ? `${value.substring(0, max)}...` : value;
}
