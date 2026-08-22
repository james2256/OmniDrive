import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateCondition, parseRule } from '../src/services/automation.service';
import type { RuleCondition } from '../src/types/automation';

describe('Automation Evaluator', () => {
  it('should match endswith for file name', () => {
    const file = { name: 'invoice.pdf', extension: 'pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'endswith', value: '.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(true);
  });

  it('should fail if condition does not match', () => {
    const file = { name: 'photo.jpg', extension: 'jpg' };
    const condition: RuleCondition = { field: 'name', operator: 'endswith', value: '.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(false);
  });

  it('should match contains for file name', () => {
    const file = { name: 'annual_report_2023.pdf', extension: 'pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'contains', value: 'report' };
    expect(evaluateCondition(file, [condition])).toBe(true);
  });

  it('should fail if contains condition does not match', () => {
    const file = { name: 'annual_report_2023.pdf', extension: 'pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'contains', value: 'invoice' };
    expect(evaluateCondition(file, [condition])).toBe(false);
  });

  it('should match equals for file name', () => {
    const file = { name: 'invoice.pdf', extension: 'pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'equals', value: 'invoice.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(true);
  });

  it('should fail if equals condition does not match', () => {
    const file = { name: 'invoice.pdf', extension: 'pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'equals', value: 'report.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(false);
  });
});

describe('parseRule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a well-formed rule row into a ParsedRule', () => {
    const row = {
      id: 'rule-1',
      user_id: 'user-1',
      conditions: JSON.stringify([{ field: 'name', operator: 'endswith', value: '.pdf' }]),
      actions: JSON.stringify([{ type: 'move', targetFolderId: 'folder-1' }]),
    };
    const result = parseRule(row);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('rule-1');
    expect(result!.userId).toBe('user-1');
    expect(result!.conditions).toHaveLength(1);
    expect(result!.actions).toHaveLength(1);
  });

  it('defaults missing conditions to an empty array', () => {
    const row = {
      id: 'rule-2',
      user_id: 'user-2',
      conditions: null,
      actions: JSON.stringify([{ type: 'delete' }]),
    };
    const result = parseRule(row);
    expect(result).not.toBeNull();
    expect(result!.conditions).toEqual([]);
    expect(result!.actions).toHaveLength(1);
  });

  it('defaults missing actions to an empty array', () => {
    const row = {
      id: 'rule-3',
      user_id: 'user-3',
      conditions: JSON.stringify([{ field: 'name', operator: 'equals', value: 'x' }]),
      actions: null,
    };
    const result = parseRule(row);
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(1);
    expect(result!.actions).toEqual([]);
  });

  it('returns null and logs when conditions JSON is malformed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = {
      id: 'rule-bad',
      user_id: 'user-bad',
      conditions: '{not valid json',
      actions: JSON.stringify([{ type: 'delete' }]),
    };
    const result = parseRule(row);
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain('Automation rule skipped');
    expect(logged).toContain('"ruleId":"rule-bad"');
    expect(logged).toContain('"userId":"user-bad"');
  });

  it('returns null and logs when actions JSON is malformed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = {
      id: 'rule-bad2',
      user_id: 'user-bad2',
      conditions: JSON.stringify([{ field: 'name', operator: 'equals', value: 'x' }]),
      actions: '{bad',
    };
    const result = parseRule(row);
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain('Automation rule skipped');
  });

  it('does not log on successful parse', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = {
      id: 'rule-ok',
      user_id: 'user-ok',
      conditions: JSON.stringify([]),
      actions: JSON.stringify([]),
    };
    const result = parseRule(row);
    expect(result).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
