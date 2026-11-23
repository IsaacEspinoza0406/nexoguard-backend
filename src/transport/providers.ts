import { HttpService } from '@nestjs/axios';
import { BadGatewayException } from '@nestjs/common';
import { OwnershipFileReader } from '../sites/infrastructure/ownership-file.reader';
import { AnalysisNetwork } from '../analysis/infrastructure/analysis-network';
import { ManualEngine } from '../analysis/application/manual-engine';
import { SslLabsClient } from '../analysis/infrastructure/ssl-labs.client';
import { remoteAnalysis, transportCall, transportConfiguration } from './client';

function remote() {
  const mode = process.env.NEXOGUARD_TRANSPORT_MODE || 'direct';
  if (!['direct', 'remote'].includes(mode) || (process.env.NEXOGUARD_HTTP_MODE === 'production' && mode !== 'remote')) throw new Error('Producción requiere transporte separado.');
  if (mode === 'remote') transportConfiguration();
  return mode === 'remote';
}
export const ownershipProvider = { provide: OwnershipFileReader, useFactory: () => remote() ? {
  read: async (domain: string) => {
    try {
      const result = await transportCall({ operation: 'ownership', domain });
      if (typeof result !== 'string' || Buffer.byteLength(result) > 256) throw new Error('TRANSPORT_INVALID_RESPONSE');
      return result;
    } catch { throw new BadGatewayException('No se pudo leer el archivo de propiedad mediante el transporte.'); }
  },
} : new OwnershipFileReader() };

export const networkProvider = { provide: AnalysisNetwork, inject: [OwnershipFileReader, HttpService], useFactory: (reader: OwnershipFileReader, http: HttpService) => remote() ? {
  destination: async (domain: string) => {
    const result = await transportCall({ operation: 'validate', domain });
    if (!result || typeof result !== 'object' || (result as { public?: unknown }).public !== true) throw new Error('DESTINATION_BLOCKED');
  },
} : new AnalysisNetwork(reader, http) };

export const engineProvider = { provide: ManualEngine, inject: [AnalysisNetwork], useFactory: (network: AnalysisNetwork) => remote() ? { run: remoteAnalysis } : new ManualEngine(network) };

export const sslProvider = { provide: SslLabsClient, inject: [HttpService, AnalysisNetwork], useFactory: (http: HttpService, network: AnalysisNetwork) => remote() ? {
  configured: () => process.env.SSLLABS_ENABLED === 'true',
  get: async (resource: 'info' | 'analyze', domain?: string) => {
    const result = await transportCall(resource === 'info' ? { operation: 'ssl-info' } : { operation: 'ssl-analyze', domain });
    if (!result || typeof result !== 'object' || !Number.isInteger((result as { status: number }).status)) throw new Error('TRANSPORT_INVALID_RESPONSE');
    return result;
  },
} : new SslLabsClient(http, network) };
