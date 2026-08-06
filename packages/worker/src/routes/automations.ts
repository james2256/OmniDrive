import { Hono } from 'hono';
import type { AppContext } from '../types/context';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { NotFoundError } from '../lib/errors';
import { mapAutomationRuleRow, mapAutomationLogRow } from '../types/db';
import { IS_ACTIVE, IS_INACTIVE } from '../services/automation.service';
import { zValidator } from '@hono/zod-validator';
import {
  createAutomationSchema,
  updateAutomationSchema,
  toggleAutomationSchema,
  zodErrorHook,
} from '../lib/schemas';

export const automationsRouter = new Hono<AppContext>({ strict: false });
automationsRouter.use('*', authGuard);

automationsRouter.get('/', async (c) => {
  const { results } = await c.get('automationRepo').findAllByUser(c.get('userId'));
  return c.json({ rules: results.map(mapAutomationRuleRow) });
});

automationsRouter.post('/', zValidator('json', createAutomationSchema, zodErrorHook), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const conditions = Array.isArray(body.conditions) ? body.conditions : [];
  const actions = Array.isArray(body.actions) ? body.actions : [];

  const id = generateId();
  await c.get('automationRepo').insert({
    id,
    userId,
    name: body.name,
    triggerType: body.triggerType,
    triggerConfig: JSON.stringify(body.triggerConfig || {}),
    conditions: JSON.stringify(conditions),
    actions: JSON.stringify(actions),
  });

  return c.json({ id }, 201);
});

// PUT /:id — update a rule definition (full replace).
// is_active intentionally excluded — use PATCH /:id/toggle for activation state.
automationsRouter.put(
  '/:id',
  zValidator('json', updateAutomationSchema, zodErrorHook),
  async (c) => {
    const body = c.req.valid('json');
    const conditions = Array.isArray(body.conditions) ? body.conditions : [];
    const actions = Array.isArray(body.actions) ? body.actions : [];
    const changed = await c.get('automationRepo').update(c.req.param('id'), c.get('userId'), {
      name: body.name,
      triggerType: body.triggerType,
      triggerConfig: JSON.stringify(body.triggerConfig || {}),
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
    });
    if (!changed) throw new NotFoundError('Automation rule not found');
    return c.body(null, 204);
  },
);

// DELETE /:id — delete a rule (CASCADE deletes associated automation_logs)
automationsRouter.delete('/:id', async (c) => {
  const deleted = await c.get('automationRepo').delete(c.req.param('id'), c.get('userId'));
  if (!deleted) throw new NotFoundError('Automation rule not found');
  return c.body(null, 204);
});

// GET /:id/logs — fetch execution logs for a rule (scoped to the caller)
automationsRouter.get('/:id/logs', async (c) => {
  const { results } = await c
    .get('automationRepo')
    .findLogsByRule(c.req.param('id'), c.get('userId'));
  return c.json({ logs: results.map(mapAutomationLogRow) });
});

automationsRouter.patch(
  '/:id/toggle',
  zValidator('json', toggleAutomationSchema, zodErrorHook),
  async (c) => {
    const { isActive } = c.req.valid('json');
    const changed = await c
      .get('automationRepo')
      .toggleActive(c.req.param('id'), c.get('userId'), isActive ? IS_ACTIVE : IS_INACTIVE);
    if (!changed) throw new NotFoundError('Automation rule not found');
    return c.body(null, 204);
  },
);
