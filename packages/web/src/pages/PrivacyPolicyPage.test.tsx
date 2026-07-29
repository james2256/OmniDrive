// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';

// PublicPageLayout uses react-router-dom's <Link> — mock it as a plain <a>.
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} data-testid={`link-${to}`} {...props}>
      {children}
    </a>
  ),
}));

describe('PrivacyPolicyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the page heading "Privacy Policy"', () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
  });

  it('renders the effective date', () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByText('Effective date: July 4, 2026')).toBeTruthy();
  });

  it('renders the "1. Introduction" section heading', () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole('heading', { level: 2, name: /1\. Introduction/ })).toBeTruthy();
  });

  it('renders the "Information We Collect" section heading', () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole('heading', { level: 2, name: /2\. Information We Collect/ }),
    ).toBeTruthy();
  });

  it('renders the "Google API Services User Data Policy" section', () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole('heading', { level: 2, name: /4\. Google API Services User Data Policy/ }),
    ).toBeTruthy();
    // The external Google policy link is rendered as an anchor
    expect(screen.getByText('Google API Services User Data Policy').closest('a')).toBeTruthy();
  });

  it('renders the "Contact" section with admin@example.com mailto link', () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole('heading', { level: 2, name: /10\. Contact/ })).toBeTruthy();
    const mailto = screen.getByText('admin@example.com').closest('a');
    expect(mailto?.getAttribute('href')).toBe('mailto:admin@example.com');
  });

  it('renders all 10 numbered section headings without errors', () => {
    render(<PrivacyPolicyPage />);

    const expectedHeadings = [
      '1. Introduction',
      '2. Information We Collect',
      '3. How We Use Your Information',
      '4. Google API Services User Data Policy',
      '5. Data Storage and Security',
      '6. Data Retention and Deletion',
      '7. Your Rights',
      "8. Children's Privacy",
      '9. Changes to This Policy',
      '10. Contact',
    ];
    expectedHeadings.forEach((heading) => {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeTruthy();
    });
  });

  it('renders the OmniDrive homepage link', () => {
    render(<PrivacyPolicyPage />);

    const homeLink = screen.getByText('omnidrive-7w1.pages.dev').closest('a');
    expect(homeLink?.getAttribute('href')).toBe('https://omnidrive-7w1.pages.dev');
  });
});
