import type { D1Database } from '@cloudflare/workers-types';

export class PolicyService {
  constructor(private db: D1Database) {}

  async checkQuota(workspaceId: string, incomingBytes: number): Promise<boolean> {
    const workspace = await this.db.prepare('SELECT used_bytes FROM workspaces WHERE id = ?').bind(workspaceId).first<{ used_bytes: number }>();
    if (!workspace) return false;

    const policy = await this.db.prepare(
      `SELECT config FROM workspace_policies 
       WHERE workspace_id = ? AND policy_type = 'storage_quota'`
    ).bind(workspaceId).first<{ config: string }>();

    if (!policy) return true; // No quota set

    const config = JSON.parse(policy.config) as { max_bytes: number };
    return (workspace.used_bytes + incomingBytes) <= config.max_bytes;
  }

  async checkRetentionProtection(folderId: string): Promise<boolean> {
    const policy = await this.db.prepare(
      `SELECT p.config 
       FROM workspace_policies p
       JOIN workspace_folders f ON f.workspace_id = p.workspace_id
       WHERE f.id = ? AND p.policy_type = 'data_retention'
         AND (p.target_type = 'workspace' OR (p.target_type = 'folder' AND p.target_id = ?))`
    ).bind(folderId, folderId).first<{ config: string }>();

    if (!policy) return false;

    const config = JSON.parse(policy.config) as { active?: boolean, prevent_deletion?: boolean };
    // Depending on exactly how retention policy is configured. 
    // We will assume active or prevent_deletion means it's protected.
    return config.active === true || config.prevent_deletion === true;
  }

  async updateWorkspaceStorage(workspaceId: string, sizeDelta: number) {
    await this.db.prepare('UPDATE workspaces SET used_bytes = COALESCE(used_bytes, 0) + ? WHERE id = ?').bind(sizeDelta, workspaceId).run();
  }
}
