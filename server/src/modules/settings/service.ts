import { eq } from 'drizzle-orm';
import type {
  ConnTestRequest as ConnTestRequestType,
  ConnTestResult,
  Settings,
  SecretsStatus,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';
import { classifyGithubError, type SyncReason } from '../pulls/sync-status.js';

/**
 * F1 — settings service. Owns the `settings` key/value table (non-secret
 * prefs, workspace+user scoped), the secrets-configured-status check, and
 * the test-connection flow. Secrets themselves are never persisted here —
 * only read/written via `container.secrets`.
 */
export interface GithubStatus {
  configured: boolean;
  ok: boolean;
  login?: string;
  reason?: SyncReason;
  message?: string;
}

export class SettingsService {
  constructor(private container: Container) {}

  async getSettings(workspaceId: string): Promise<Settings> {
    const rows = await this.container.db
      .select()
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
    return rowsToSettings(rows);
  }

  async updateSettings(
    workspaceId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<Settings> {
    for (const [key, value] of Object.entries(body)) {
      await this.container.db
        .insert(t.settings)
        .values({ workspaceId, userId, key, value })
        .onConflictDoUpdate({
          target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
          set: { value },
        });
    }
    return this.getSettings(workspaceId);
  }

  async getSecretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /**
   * REAL GitHub token check (calls GitHub; `secrets-status` only says a value exists).
   * `ok:false` + reason when the token is missing, rejected (401) or otherwise unusable.
   */
  async getGithubStatus(): Promise<GithubStatus> {
    const configured = Boolean(await this.container.secrets.get('GITHUB_TOKEN'));
    if (!configured) return { configured, ok: false, reason: 'no_token', message: 'GITHUB_TOKEN is not configured' };
    try {
      const gh = await this.container.github();
      return { configured, ok: true, login: await gh.currentLogin() };
    } catch (err) {
      const { reason, message } = classifyGithubError(err);
      return { configured, ok: false, reason, message };
    }
  }

  async testConnection(req: ConnTestRequestType): Promise<ConnTestResult> {
    const { provider, key } = req;
    try {
      // If the UI supplied a key, persist it (BYO key) before testing so the
      // test reflects — and the rest of the app can use — the new value.
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        this.container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await this.container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
