// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TermsOfServicePage } from './TermsOfServicePage';

// PublicPageLayout uses react-router-dom's <Link> — mock it as a plain <a>.
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} data-testid={`link-${to}`} {...props}>
      {children}
    </a>
  ),
}));

// Mock PUBLIC_URL so tests don't require VITE_PUBLIC_URL env var.
vi.mock('../lib/site', () => ({ PUBLIC_URL: 'https://test.example.com' }));

describe('TermsOfServicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the page heading "Terms of Service"', () => {
    render(<TermsOfServicePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy();
  });

  it('renders the effective date', () => {
    render(<TermsOfServicePage />);

    expect(screen.getByText('Effective date: July 4, 2026')).toBeTruthy();
  });

  it('renders the "1. Acceptance of Terms" section heading', () => {
    render(<TermsOfServicePage />);

    expect(screen.getByRole('heading', { level: 2, name: /1\. Acceptance of Terms/ })).toBeTruthy();
  });

  it('renders the "Description of Service" section heading', () => {
    render(<TermsOfServicePage />);

    expect(
      screen.getByRole('heading', { level: 2, name: /2\. Description of Service/ }),
    ).toBeTruthy();
  });

  it('renders the "Acceptable Use" section with prohibited-use list', () => {
    render(<TermsOfServicePage />);

    expect(screen.getByRole('heading', { level: 2, name: /5\. Acceptable Use/ })).toBeTruthy();
    // One of the prohibited-use list items is rendered
    expect(
      screen.getByText(
        'Use the Service for unlawful purposes or to store/distribute illegal content',
      ),
    ).toBeTruthy();
  });

  it('renders the "Limitation of Liability" section', () => {
    render(<TermsOfServicePage />);

    expect(
      screen.getByRole('heading', { level: 2, name: /8\. Limitation of Liability/ }),
    ).toBeTruthy();
  });

  it('renders the "Contact" section with admin@example.com mailto link', () => {
    render(<TermsOfServicePage />);

    expect(screen.getByRole('heading', { level: 2, name: /11\. Contact/ })).toBeTruthy();
    const mailto = screen.getByText('admin@example.com').closest('a');
    expect(mailto?.getAttribute('href')).toBe('mailto:admin@example.com');
  });

  it('renders all 11 numbered section headings without errors', () => {
    render(<TermsOfServicePage />);

    const expectedHeadings = [
      '1. Acceptance of Terms',
      '2. Description of Service',
      '3. Account Registration',
      '4. Google Drive Connection',
      '5. Acceptable Use',
      '6. Your Content',
      '7. Service Availability',
      '8. Limitation of Liability',
      '9. Termination',
      '10. Changes to Terms',
      '11. Contact',
    ];
    expectedHeadings.forEach((heading) => {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeTruthy();
    });
  });

  it('renders the Google Terms of Service external link', () => {
    render(<TermsOfServicePage />);

    const googleTermsLink = screen.getByText("Google's Terms of Service").closest('a');
    expect(googleTermsLink?.getAttribute('href')).toBe('https://policies.google.com/terms');
    expect(googleTermsLink?.getAttribute('target')).toBe('_blank');
    expect(googleTermsLink?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the OmniDrive homepage link', () => {
    render(<TermsOfServicePage />);

    const homeLink = screen.getByText('test.example.com').closest('a');
    expect(homeLink?.getAttribute('href')).toBe('https://test.example.com');
  });
});
