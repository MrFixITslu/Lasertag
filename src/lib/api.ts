export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const body = await response.json().catch(() => { throw new ApiError('The booking server is unavailable. Please try again later.', response.status); });
  if (!response.ok) throw new ApiError(body.error || 'Request failed. Please try again.', response.status);
  return body as T;
}
