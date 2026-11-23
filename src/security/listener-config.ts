import { isIP } from 'node:net';

export function listenerConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto de escucha inválido.');
  const trusted = env.NEXOGUARD_TRUST_PROXY_IP;
  if (trusted && !isIP(trusted)) throw new Error('El proxy confiable debe ser una IP exacta.');
  return { port, host: env.HOST || '127.0.0.1', trustProxy: trusted || false };
}
