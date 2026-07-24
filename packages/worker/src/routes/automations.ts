import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { AppError } from '../lib/errors';
import { mapAutomationRuleRow } from '../types/index';
import { IS_ACTIVE, IS_INACTIVE } from '../services/automation.service';
import { zValidator } from '@hono/zod-validator';
import { createAutomationSchema, toggleAutomationSchema, zodErrorHook } from '../lib/schemas';

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
    id, userId, name: body.name,
    triggerType: body.trigger_type,
    triggerConfig: JSON.stringify(body.trigger_config || {}),
    conditions: JSON.stringify(conditions),
    actions: JSON.stringify(actions),
  });

  return c.json({ id, success: true }, 201);
});

automationsRouter.patch('/:id/toggle', zValidator('json', toggleAutomationSchema, zodErrorHook), async (c) => {
  const { is_active } = c.req.valid('json');
  const changed = await c.get('automationRepo').toggleActive(
    c.req.param('id'), c.get('userId'), is_active ? IS_ACTIVE : IS_INACTIVE,
  );
  if (!changed) throw new AppError(404, 'Automation rule not found');
  return c.json({ success: true });
});
