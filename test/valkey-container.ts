import { execFileSync } from 'child_process';
import { createServer } from 'net';

export const VALKEY_IMAGE = process.env.VALKEY_IMAGE || 'valkey/valkey:9.1';

export type ValkeyContainer = {
  name: string;
  host: string;
  port: number;
  url: string;
  version: string;
  stop: () => void;
};

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cli(name: string, ...args: string[]): string {
  return docker('exec', name, 'valkey-cli', ...args);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${what}${detail}`);
}

// Starts a single-node Valkey cluster owning all 16384 slots, reachable from the host on 127.0.0.1.
export async function startValkeyCluster(): Promise<ValkeyContainer> {
  const port = await freePort();
  const name = `nestjs-ioredis-valkey-${port}`;

  // Container listens on 6379 (bus 16379); the node announces the host-mapped port so
  // CLUSTER SLOTS returns an address reachable from the host.
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `127.0.0.1:${port}:6379`,
    VALKEY_IMAGE,
    'valkey-server',
    '--cluster-enabled',
    'yes',
    '--cluster-announce-ip',
    '127.0.0.1',
    '--cluster-announce-port',
    String(port),
    '--save',
    '',
    '--appendonly',
    'no',
  );

  const stop = () => {
    try {
      docker('rm', '-f', name);
    } catch {
      // already gone
    }
  };

  try {
    await waitFor(() => cli(name, 'ping') === 'PONG', 30000, 'valkey to accept connections');
    cli(name, 'cluster', 'addslotsrange', '0', '16383');
    await waitFor(() => cli(name, 'cluster', 'info').includes('cluster_state:ok'), 30000, 'cluster_state:ok');
  } catch (error) {
    let logs = '';
    try {
      logs = docker('logs', name);
    } catch {
      // container may not exist
    }
    stop();
    throw new Error(`${(error as Error).message}\n--- ${name} logs ---\n${logs}`);
  }

  const version = cli(name, 'info', 'server').match(/(?:valkey|redis)_version:(\S+)/)?.[1] ?? 'unknown';

  return { name, host: '127.0.0.1', port, url: `redis://127.0.0.1:${port}`, version, stop };
}
