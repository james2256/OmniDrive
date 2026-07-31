import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationRepository } from '../src/repositories/automation.repository';

/**
 * Direct unit tests for AutomationRepository. Verifies SQL fragments and
 * bind values for each method. Complementary to integration/repositories.test.ts
 * which exercises the same repository through a real D1.
 *
 * NOTE: the task spec referenced a `delete` method — AutomationRepository only
 * exports `findAllByUser`, `insert`, `toggleActive`. Tests cover the actual
 * exports; no `delete` method exists in the source.
 */

describe('AutomationRepository', () => {
  let repo: AutomationRepository;
  let mockPrepare: ReturnType<typeof vi.fn>;
  let mockBind: ReturnType<typeof vi.fn>;
  let mockAll: ReturnType<typeof vi.fn>;
  let mockFirst: ReturnType<typeof vi.fn>;
  let mockRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll = vi.fn().mockResolvedValue({ results: [] });
    mockFirst = vi.fn().mockResolvedValue(null);
    mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    mockBind = vi.fn().mockReturnValue({ all: mockAll, first: mockFirst, run: mockRun });
    mockPrepare = vi.fn().mockReturnValue({
      bind: mockBind,
      all: mockAll,
      first: mockFirst,
      run: mockRun,
    });
    const mockDb = { prepare: mockPrepare } as any;
    repo = new AutomationRepository(mockDb);
  });

  describe('findAllByUser', () => {
    it('selects all rules for a user, single bind', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'r1', user_id: 'u-1', name: 'Auto-move', is_active: 1 }],
      });

      const { results } = await repo.findAllByUser('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT * FROM automation_rules WHERE user_id = ?');
      expect(mockBind).toHaveBeenCalledWith('u-1');
      expect(results).toHaveLength(1);
    });
  });

  describe('insert', () => {
    it('INSERTs a new rule with all seven fields in order', async () => {
      await repo.insert({
        id: 'r-1',
        userId: 'u-1',
        name: 'Auto-move PDFs',
        triggerType: 'file_create',
        triggerConfig: '{}',
        conditions: '{"mime":"application/pdf"}',
        actions: '{"folder":"f-1"}',
      });

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO automation_rules');
      expect(sql).toContain('id, user_id, name, trigger_type, trigger_config, conditions, actions');
      expect(sql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?)');
      expect(mockBind).toHaveBeenCalledWith(
        'r-1',
        'u-1',
        'Auto-move PDFs',
        'file_create',
        '{}',
        '{"mime":"application/pdf"}',
        '{"folder":"f-1"}',
      );
    });
  });

  describe('toggleActive', () => {
    it('UPDATEs is_active with updated_at=CURRENT_TIMESTAMP, scoped to user', async () => {
      const changed = await repo.toggleActive('r-1', 'u-1', 0);

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE automation_rules SET is_active = ?');
      expect(sql).toContain('updated_at = CURRENT_TIMESTAMP');
      expect(sql).toContain('WHERE id = ? AND user_id = ?');
      expect(mockBind).toHaveBeenCalledWith(0, 'r-1', 'u-1');
      expect(changed).toBe(true);
    });

    it('returns true when meta.changes > 0 (row updated)', async () => {
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });
      const changed = await repo.toggleActive('r-1', 'u-1', 1);
      expect(changed).toBe(true);
    });

    it('returns false when meta.changes === 0 (wrong user / rule missing)', async () => {
      mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });
      const changed = await repo.toggleActive('r-1', 'wrong-user', 1);
      expect(changed).toBe(false);
      expect(mockBind).toHaveBeenCalledWith(1, 'r-1', 'wrong-user');
    });

    it('binds the isActive value first, then ruleId, then userId', async () => {
      await repo.toggleActive('rule-xyz', 'user-abc', 1);
      expect(mockBind).toHaveBeenNthCalledWith(1, 1, 'rule-xyz', 'user-abc');
    });

    it('can toggle to inactive (0) and active (1) — both binary states', async () => {
      await repo.toggleActive('r-1', 'u-1', 0);
      expect(mockBind).toHaveBeenNthCalledWith(1, 0, 'r-1', 'u-1');

      await repo.toggleActive('r-1', 'u-1', 1);
      expect(mockBind).toHaveBeenNthCalledWith(2, 1, 'r-1', 'u-1');
    });
  });

  // ─── PR 2: trigger-rule reads for the automation engine ───

  describe('findActiveEventRulesForUser', () => {
    it('SELECTs active event rules for a user, binds (event, 1, userId)', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'r-1', trigger_type: 'event', is_active: 1 }],
      });

      await repo.findActiveEventRulesForUser('u-1');

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT * FROM automation_rules WHERE trigger_type = ? AND is_active = ? AND user_id = ?',
      );
      // The repo binds the trigger-type + active-state literals so callers can't drift.
      expect(mockBind).toHaveBeenCalledWith('event', 1, 'u-1');
    });
  });

  describe('findActiveCronRules', () => {
    it('SELECTs all active cron rules (no user scope), binds (cron, 1)', async () => {
      mockAll.mockResolvedValueOnce({
        results: [{ id: 'r-1', trigger_type: 'cron', is_active: 1 }],
      });

      await repo.findActiveCronRules();

      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain(
        'SELECT * FROM automation_rules WHERE trigger_type = ? AND is_active = ?',
      );
      expect(mockBind).toHaveBeenCalledWith('cron', 1);
    });
  });
});
