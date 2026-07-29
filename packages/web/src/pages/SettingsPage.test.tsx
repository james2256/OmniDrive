// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';

// Mock all 3 settings tab components — they are already individually tested.
vi.mock('../components/settings/SettingsAccountTab', () => ({
  SettingsAccountTab: () => <div data-testid="account-tab">SettingsAccountTab</div>,
}));
vi.mock('../components/settings/SettingsDrivesTab', () => ({
  SettingsDrivesTab: () => <div data-testid="drives-tab">SettingsDrivesTab</div>,
}));
vi.mock('../components/settings/SettingsS3Tab', () => ({
  SettingsS3Tab: () => <div data-testid="s3-tab">SettingsS3Tab</div>,
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the "Settings" page title', () => {
    render(<SettingsPage />);

    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('renders the SettingsAccountTab component', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('account-tab')).toBeTruthy();
  });

  it('renders the SettingsDrivesTab component', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('drives-tab')).toBeTruthy();
  });

  it('renders the SettingsS3Tab component', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('s3-tab')).toBeTruthy();
  });

  it('renders all three tab components together', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('account-tab')).toBeTruthy();
    expect(screen.getByTestId('drives-tab')).toBeTruthy();
    expect(screen.getByTestId('s3-tab')).toBeTruthy();
  });
});
