# Enterprise Workspace Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a robust Role-Based Access Control (RBAC) system with predefined roles and automated Audit Trails.

**Architecture:** We will extend the `workspace_members` schema to support granular roles, create an `audit_logs` table, implement an RBAC middleware for backend protection, and add an automated Cloudflare worker scheduled event to purge logs older than 30 days.

**Tech Stack:** React, Hono, SQLite (Cloudflare D1), TypeScript.

---

### Task 1: Database Migration and Schema

**Files:**
- Create: `packages/worker/src/db/0002_enterprise_workspace_phase1.sql`
- Modify: `packages/worker/src/db/schema.sql`

- [ ] **Step 1: Write the migration script**

```sql
-- packages/worker/src/db/0002_enterprise_workspace_phase1.sql
PRAGMA foreign_keys=off;

ALTER TABLE workspace_members RENAME TO workspace_members_old;

CREATE TABLE IF NOT EXISTS workspace_members (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'manager', 'auditor', 'owner')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, user_id)
);

INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
SELECT id, workspace_id, user_id, role, joined_at FROM workspace_members_old;

DROP TABLE workspace_members_old;

CREATE TABLE IF NOT EXISTS audit_logs (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,
    resource_id     TEXT,
    resource_name   TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

PRAGMA foreign_keys=on;
```

- [ ] **Step 2: Update schema.sql to match**

```sql
-- Replace the old workspace_members definition in packages/worker/src/db/schema.sql with:
CREATE TABLE IF NOT EXISTS workspace_members (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'manager', 'auditor', 'owner')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, user_id)
);

-- Add the new audit_logs table at the bottom of schema.sql:
CREATE TABLE IF NOT EXISTS audit_logs (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL,
    resource_id     TEXT,
    resource_name   TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
```

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/db/0002_enterprise_workspace_phase1.sql packages/worker/src/db/schema.sql
git commit -m "feat: add enterprise workspace rbac and audit log schemas"
```

### Task 2: Shared Types Update

**Files:**
- Modify: `packages/web/src/types/index.ts`

- [ ] **Step 1: Update roles and add AuditLog in web types**

```typescript
// Edit packages/web/src/types/index.ts
// Replace the role type in WorkspaceMember:
export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'viewer' | 'commenter' | 'editor' | 'manager' | 'auditor' | 'owner';
  joinedAt: string;
}

// Add AuditLog type at the bottom:
export interface AuditLog {
  id: string;
  workspaceId: string | null;
  actorId: string;
  actionType: string;
  resourceId: string | null;
  resourceName: string | null;
  metadata: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/types/index.ts
git commit -m "feat: update workspace role types and add audit log type"
```

### Task 3: Backend Audit Service

**Files:**
- Create: `packages/worker/src/services/audit.service.ts`

- [ ] **Step 1: Write audit service**

```typescript
// packages/worker/src/services/audit.service.ts
import { generateId } from '../lib/id';

export class AuditService {
  constructor(private db: D1Database) {}

  async logEvent(params: {
    workspaceId: string | null;
    actorId: string;
    actionType: string;
    resourceId?: string;
    resourceName?: string;
    metadata?: any;
  }) {
    const id = generateId();
    await this.db.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_id, action_type, resource_id, resource_name, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      params.workspaceId,
      params.actorId,
      params.actionType,
      params.resourceId || null,
      params.resourceName || null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ).run();
  }

  async cleanupOldLogs(daysToKeep = 30) {
    await this.db.prepare(
      `DELETE FROM audit_logs WHERE created_at < datetime('now', '-' || ? || ' days')`
    ).bind(daysToKeep).run();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/worker/src/services/audit.service.ts
git commit -m "feat: implement audit service"
```

### Task 4: Automated Audit Log Cleanup

**Files:**
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Wire up cleanup job**

```typescript
// In packages/worker/src/index.ts
// Add import:
import { AuditService } from './services/audit.service';

// Inside the scheduled handler, add the cleanup execution:
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('Cron triggered:', event.cron);
    ctx.waitUntil(runScheduledSync(env));
    const engine = new AutomationEngine(env);
    ctx.waitUntil(engine.processCronTrigger(ctx));
    
    // NEW: Audit log cleanup
    const auditService = new AuditService(env.DB);
    ctx.waitUntil(auditService.cleanupOldLogs(30));
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/worker/src/index.ts
git commit -m "feat: add cron job for audit log cleanup"
```

### Task 5: RBAC Middleware and Route Updates

**Files:**
- Create: `packages/worker/src/middleware/rbac.ts`
- Modify: `packages/worker/src/routes/workspaces.ts`

- [ ] **Step 1: Write RBAC utility**

```typescript
// packages/worker/src/middleware/rbac.ts
export async function getWorkspaceRole(db: D1Database, workspaceId: string, userId: string): Promise<string | null> {
  const member = await db.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, userId).first<{ role: string }>();
  return member ? member.role : null;
}

export function hasPermission(role: string, requiredRole: 'viewer' | 'editor' | 'manager' | 'owner'): boolean {
  const levels = {
    'viewer': 1,
    'auditor': 1,
    'commenter': 2,
    'editor': 3,
    'manager': 4,
    'owner': 5
  };
  return (levels[role as keyof typeof levels] || 0) >= levels[requiredRole];
}
```

- [ ] **Step 2: Update endpoints and integrate audit logging**

```typescript
// In packages/worker/src/routes/workspaces.ts
// Add imports:
import { getWorkspaceRole, hasPermission } from '../middleware/rbac';
import { AuditService } from '../services/audit.service';

// Modify POST /:id/members route to check permissions and log:
workspacesRouter.post('/:id/members', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');
  const { email, role = 'viewer' } = await c.req.json<{ email?: string, role?: string }>();

  if (!email) return c.json({ error: 'Email is required' }, 400);

  const currentUserRole = await getWorkspaceRole(db, workspaceId, userId);
  if (!currentUserRole || !hasPermission(currentUserRole, 'manager')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const targetUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!targetUser) return c.json({ error: 'User not found' }, 404);

  const memberId = generateId();
  try {
    await db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)')
      .bind(memberId, workspaceId, targetUser.id, role).run();
      
    // Log audit event
    const auditService = new AuditService(db);
    await auditService.logEvent({
      workspaceId,
      actorId: userId,
      actionType: 'member.invite',
      resourceId: targetUser.id,
      resourceName: email,
      metadata: { role }
    });
  } catch (e: any) {
    if (e.message.includes('UNIQUE constraint failed')) return c.json({ error: 'User is already a member' }, 409);
    throw e;
  }
  return c.json({ success: true }, 201);
});

// Add GET /:id/audit-logs
workspacesRouter.get('/:id/audit-logs', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const workspaceId = c.req.param('id');

  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role || (role !== 'owner' && role !== 'manager' && role !== 'auditor')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await db.prepare(
    'SELECT a.*, u.email as actor_email FROM audit_logs a JOIN users u ON a.actor_id = u.id WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(workspaceId).all();

  return c.json({ logs: results });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/middleware/rbac.ts packages/worker/src/routes/workspaces.ts
git commit -m "feat: enforce RBAC and add workspace audit logging"
```

### Task 6: Global Admin Audit Logs Route

**Files:**
- Create: `packages/worker/src/routes/admin.ts`
- Modify: `packages/worker/src/index.ts`

- [ ] **Step 1: Create admin route**

```typescript
// packages/worker/src/routes/admin.ts
import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';

export const adminRouter = new Hono<AppContext>({ strict: false });

adminRouter.use('*', authGuard);

adminRouter.get('/audit-logs', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  // Simple super-admin check (for now, verify specific email or role). 
  // Let's assume user ID 'admin_123' or email check is performed.
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user || !user.email.endsWith('@omnidrive.app')) { // Mock enterprise domain logic
    return c.json({ error: 'Forbidden. Super Admin only.' }, 403);
  }

  const { results } = await db.prepare(
    'SELECT a.*, u.email as actor_email, w.name as workspace_name FROM audit_logs a JOIN users u ON a.actor_id = u.id LEFT JOIN workspaces w ON a.workspace_id = w.id ORDER BY a.created_at DESC LIMIT 100'
  ).all();

  return c.json({ logs: results });
});
```

- [ ] **Step 2: Register admin route in index.ts**

```typescript
// In packages/worker/src/index.ts
// Add import:
import { adminRouter } from './routes/admin';

// Register route alongside others:
app.route('/api/admin', adminRouter);
```

- [ ] **Step 3: Commit**

```bash
git add packages/worker/src/routes/admin.ts packages/worker/src/index.ts
git commit -m "feat: add global admin audit logs route"
```

### Task 7: Frontend Web API Client Updates

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add audit log endpoints to API client**

```typescript
// In packages/web/src/lib/api.ts
// Add inside the api object:

  getWorkspaceAuditLogs: async (workspaceId: string) => {
    const res = await fetch(`${API_URL}/workspaces/${workspaceId}/audit-logs`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch audit logs');
    return res.json();
  },

  getAdminAuditLogs: async () => {
    const res = await fetch(`${API_URL}/admin/audit-logs`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch admin audit logs');
    return res.json();
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat: add audit logs fetching to api client"
```

### Task 8: Frontend UI for Audit Logs

**Files:**
- Create: `packages/web/src/components/workspaces/WorkspaceAuditTab.tsx`
- Modify: `packages/web/src/components/workspaces/WorkspaceMainView.tsx`

- [ ] **Step 1: Create Audit Tab Component**

```tsx
// packages/web/src/components/workspaces/WorkspaceAuditTab.tsx
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function WorkspaceAuditTab({ workspaceId }: { workspaceId: string }) {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    api.getWorkspaceAuditLogs(workspaceId).then((res) => setLogs(res.logs)).catch(console.error);
  }, [workspaceId]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Audit Logs</h2>
      <table className="w-full text-left bg-white rounded-lg shadow overflow-hidden">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Actor</th>
            <th className="px-4 py-2">Action</th>
            <th className="px-4 py-2">Resource</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="px-4 py-2">{new Date(log.created_at).toLocaleString()}</td>
              <td className="px-4 py-2">{log.actor_email}</td>
              <td className="px-4 py-2 font-mono text-xs">{log.action_type}</td>
              <td className="px-4 py-2">{log.resource_name || log.resource_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into WorkspaceMainView**

```tsx
// Edit packages/web/src/components/workspaces/WorkspaceMainView.tsx
// 1. Add import:
import { WorkspaceAuditTab } from './WorkspaceAuditTab';

// 2. Add 'audit' to the activeTab state:
const [activeTab, setActiveTab] = useState<'files' | 'members' | 'settings' | 'audit'>('files');

// 3. Add 'audit' to the tabs array map:
{(['files', 'members', 'settings', 'audit'] as const).map(tab => (

// 4. Add the component to the content area:
{activeTab === 'audit' && <WorkspaceAuditTab workspaceId={activeFolder.id} />}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workspaces/WorkspaceAuditTab.tsx packages/web/src/components/workspaces/WorkspaceMainView.tsx
git commit -m "feat: implement workspace audit logs UI"
```
