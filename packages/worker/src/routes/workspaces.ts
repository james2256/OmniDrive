import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { zValidator } from '@hono/zod-validator';
import {
  createWorkspaceSchema,
  addWorkspaceMemberSchema,
  workspacePolicySchema,
  updateWorkspaceMetadataSchema,
  zodErrorHook,
} from '../lib/schemas';

export const workspacesRouter = new Hono<AppContext>({ strict: false });

workspacesRouter.use('*', authGuard);

// GET / — list workspaces the user is a member of
workspacesRouter.get('/', async (c) => {
  const workspaces = await c.get('workspaceService').listWorkspaces(c.get('userId'));
  return c.json({ workspaces });
});

// POST / — create a workspace
workspacesRouter.post('/', zValidator('json', createWorkspaceSchema, zodErrorHook), async (c) => {
  const { name } = c.req.valid('json');
  const workspace = await c.get('workspaceService').createWorkspace(c.get('userId'), name);
  return c.json({ workspace }, 201);
});

// POST /:id/members — add a member (manager + role-escalation check)
workspacesRouter.post('/:id/members', zValidator('json', addWorkspaceMemberSchema, zodErrorHook), async (c) => {
  const { email, role } = c.req.valid('json');
  await c.get('workspaceService').addMember(c.get('userId'), c.req.param('id'), email, role);
  return c.json({ success: true }, 201);
});

// DELETE /:id/members/:targetUserId — remove a member (self-removal + manager + owner-removal + last-owner checks)
workspacesRouter.delete('/:id/members/:targetUserId', async (c) => {
  await c.get('workspaceService').removeMember(c.get('userId'), c.req.param('id'), c.req.param('targetUserId'));
  return c.json({ success: true });
});

// GET /:id/audit-logs — owner/manager/auditor only
workspacesRouter.get('/:id/audit-logs', async (c) => {
  const logs = await c.get('workspaceService').getAuditLogs(c.get('userId'), c.req.param('id'));
  return c.json({ logs });
});

// GET /:id/policies — manager required
workspacesRouter.get('/:id/policies', async (c) => {
  const policies = await c.get('workspaceService').getPolicies(c.get('userId'), c.req.param('id'));
  return c.json({ policies });
});

// POST /:id/policies — manager required
workspacesRouter.post('/:id/policies', zValidator('json', workspacePolicySchema, zodErrorHook), async (c) => {
  const { targetType, targetId, policyType, config } = c.req.valid('json');
  const policy = await c.get('workspaceService').createPolicy(c.get('userId'), c.req.param('id'), {
    targetType, targetId: targetId || null, policyType, config,
  });
  return c.json({ policy }, 201);
});

// DELETE /:id/policies/:policyId — manager required
workspacesRouter.delete('/:id/policies/:policyId', async (c) => {
  await c.get('workspaceService').deletePolicy(c.get('userId'), c.req.param('id'), c.req.param('policyId'));
  return c.json({ success: true });
});

// PATCH /:id/folders/:folderId/metadata — editor required
workspacesRouter.patch('/:id/folders/:folderId/metadata', zValidator('json', updateWorkspaceMetadataSchema, zodErrorHook), async (c) => {
  const { metadata } = c.req.valid('json');
  await c.get('workspaceService').updateFolderMetadata(c.get('userId'), c.req.param('id'), c.req.param('folderId'), metadata);
  return c.json({ success: true });
});
