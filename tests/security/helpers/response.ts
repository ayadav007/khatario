export async function readJsonResponse(response: Response): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: response.status, json };
}

export function subscriptionDeniedStatuses(): number[] {
  return [401, 403];
}
