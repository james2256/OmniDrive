import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../src/services/automation.service';
import type { RuleCondition } from '../src/types/automation';

describe('Automation Evaluator', () => {
  it('should match endswith for file name', () => {
    const file = { name: 'invoice.pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'endswith', value: '.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(true);
  });

  it('should fail if condition does not match', () => {
    const file = { name: 'photo.jpg' };
    const condition: RuleCondition = { field: 'name', operator: 'endswith', value: '.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(false);
  });

  it('should match contains for file name', () => {
    const file = { name: 'annual_report_2023.pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'contains', value: 'report' };
    expect(evaluateCondition(file, [condition])).toBe(true);
  });

  it('should fail if contains condition does not match', () => {
    const file = { name: 'annual_report_2023.pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'contains', value: 'invoice' };
    expect(evaluateCondition(file, [condition])).toBe(false);
  });

  it('should match equals for file name', () => {
    const file = { name: 'invoice.pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'equals', value: 'invoice.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(true);
  });

  it('should fail if equals condition does not match', () => {
    const file = { name: 'invoice.pdf' };
    const condition: RuleCondition = { field: 'name', operator: 'equals', value: 'report.pdf' };
    expect(evaluateCondition(file, [condition])).toBe(false);
  });
});
