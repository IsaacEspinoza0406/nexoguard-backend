import { canonicalDomain } from '../sites/domain/domain';

export type TransportRequest = { operation: 'analyze' | 'ownership' | 'validate' | 'ssl-info' | 'ssl-analyze'; domain?: string };
export function transportRequest(value: unknown): TransportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['operation', 'domain'].includes(key))) throw new Error('INVALID_REQUEST');
  if (!['analyze', 'ownership', 'validate', 'ssl-info', 'ssl-analyze'].includes(String(body.operation))) throw new Error('INVALID_REQUEST');
  if (body.operation === 'ssl-info') {
    if (body.domain !== undefined) throw new Error('INVALID_REQUEST');
  } else if (typeof body.domain !== 'string' || canonicalDomain(body.domain) !== body.domain) throw new Error('INVALID_REQUEST');
  return body as TransportRequest;
}
