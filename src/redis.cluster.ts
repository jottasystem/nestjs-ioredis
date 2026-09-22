import { Cluster } from 'ioredis';

/**
 * DI token for the ioredis Cluster instance created by RedisModule.
 * Abstract so it can never be instantiated directly — always inject it.
 */
export abstract class RedisCluster extends Cluster {}
