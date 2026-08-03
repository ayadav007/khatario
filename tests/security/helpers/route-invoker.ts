import type { NextRequest } from 'next/server';
import type { PremiumRouteSpec } from '../fixtures/premium-routes';

export async function invokePremiumRoute(
  spec: PremiumRouteSpec,
  request: NextRequest,
): Promise<Response> {
  const mod = await import(spec.importPath);
  const handler = mod[spec.method] as
    | ((req: NextRequest, ctx?: { params: Record<string, string> }) => Promise<Response>)
    | undefined;

  if (!handler) {
    throw new Error(`Handler ${spec.method} not exported from ${spec.importPath}`);
  }

  if (spec.routeParams) {
    return handler(request, { params: spec.routeParams });
  }

  return handler(request);
}

export function buildPathWithQuery(
  path: string,
  query?: Record<string, string>,
): string {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }
  const params = new URLSearchParams(query);
  return `${path}?${params.toString()}`;
}
