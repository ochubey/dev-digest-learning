/** Thin fetch wrapper over the DevDigest API. */

export const DEFAULT_API_BASE = 'http://localhost:3001';

export class ApiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export interface ApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function apiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.DEVDIGEST_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
}

/**
 * GET `path` and return the parsed JSON. Throws ApiHttpError on a non-2xx status.
 * No auth header: the API's local auth provider resolves the default workspace itself.
 */
export async function apiGet<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.baseUrl ?? apiBase()}${path}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    throw new ApiHttpError(res.status, `HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}
