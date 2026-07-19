import { describe, it, expect } from 'vitest';
import { validateWebhookUrl } from '../src/lib/validation';

describe('validateWebhookUrl', () => {
  it('rejects non-HTTPS URLs', () => {
    expect(validateWebhookUrl('http://example.com/hook')).toBe('Webhook URL must use HTTPS');
  });

  it('rejects localhost', () => {
    expect(validateWebhookUrl('https://localhost/hook')).toBe('Webhook URL must not point to private/internal addresses');
  });

  it('rejects 127.0.0.1', () => {
    expect(validateWebhookUrl('https://127.0.0.1/hook')).toBe('Webhook URL must not point to private/internal addresses');
  });

  it('rejects cloud metadata IP', () => {
    expect(validateWebhookUrl('https://169.254.169.254/latest/meta-data')).toBe('Webhook URL must not point to private/internal addresses');
  });

  it('rejects private 10.x.x.x range', () => {
    expect(validateWebhookUrl('https://10.0.0.1/hook')).toBe('Webhook URL must not point to private/internal addresses');
  });

  it('rejects private 192.168.x.x range', () => {
    expect(validateWebhookUrl('https://192.168.1.1/hook')).toBe('Webhook URL must not point to private/internal addresses');
  });

  it('rejects private 172.16-31.x.x range', () => {
    expect(validateWebhookUrl('https://172.16.0.1/hook')).toBe('Webhook URL must not point to private/internal addresses');
    expect(validateWebhookUrl('https://172.31.255.255/hook')).toBe('Webhook URL must not point to private/internal addresses');
  });

  it('allows valid 172.x addresses outside private range', () => {
    expect(validateWebhookUrl('https://172.32.0.1/hook')).toBeNull();
  });

  it('rejects invalid URLs', () => {
    expect(validateWebhookUrl('not-a-url')).toBe('Invalid webhook URL');
  });

  it('accepts valid public HTTPS URLs', () => {
    expect(validateWebhookUrl('https://hooks.slack.com/services/xxx')).toBeNull();
    expect(validateWebhookUrl('https://example.com/webhook')).toBeNull();
  });
});
