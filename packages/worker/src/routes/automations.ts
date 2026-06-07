import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';

export const automationsRouter = new Hono<AppContext>({ strict: false });
automationsRouter.use('*', authGuard);

interface AutomationRuleRecord {
  id: string;
  user_id: string;
  name: string;
  trigger_type: string;
  trigger_config: string | null;
  conditions: string | null;
  actions: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface AutomationRuleBody {
  name: string;
  trigger_type: string;
  trigger_config?: Record<string, unknown>;
  conditions?: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
}

automationsRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare('SELECT * FROM automation_rules WHERE user_id = ?').bind(userId).all<AutomationRuleRecord>();
  return c.json({
    rules: results.map((r) => ({
      ...r,
      trigger_config: JSON.parse(r.trigger_config || '{}'),
      conditions: JSON.parse(r.conditions || '[]'),
      actions: JSON.parse(r.actions || '[]'),
      is_active: Boolean(r.is_active)
    }))
  });
});

automationsRouter.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<AutomationRuleBody>();
  const id = generateId();
  
  await c.env.DB.prepare(`
    INSERT INTO automation_rules (id, user_id, name, trigger_type, trigger_config, conditions, actions) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, body.name, body.trigger_type, 
    JSON.stringify(body.trigger_config || {}), 
    JSON.stringify(body.conditions || []), 
    JSON.stringify(body.actions || [])
  ).run();
  
  return c.json({ id, success: true }, 201);
});

automationsRouter.patch('/:id/toggle', async (c) => {
  const userId = c.get('userId');
  const ruleId = c.req.param('id');
  const body = await c.req.json<{ is_active: boolean }>();
  
  await c.env.DB.prepare('UPDATE automation_rules SET is_active = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?')
    .bind(body.is_active ? 1 : 0, ruleId, userId).run();
    
  return c.json({ success: true });
});
