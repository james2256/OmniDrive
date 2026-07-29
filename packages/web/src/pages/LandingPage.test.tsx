// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LandingPage } from './LandingPage';

// react-router-dom's <Link> is used for navigation — mock it as a plain <a>.
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} data-testid={`link-${to}`} {...props}>
      {children}
    </a>
  ),
}));

// Mock lucide-react icons used in the features array.
vi.mock('lucide-react', () => ({
  Cloud: (props: any) => <svg data-testid="icon-cloud" {...props} />,
  FolderSync: (props: any) => <svg data-testid="icon-folder-sync" {...props} />,
  Link2: (props: any) => <svg data-testid="icon-link2" {...props} />,
  Shield: (props: any) => <svg data-testid="icon-shield" {...props} />,
  Users: (props: any) => <svg data-testid="icon-users" {...props} />,
}));

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the hero heading "Unified multi-Google Drive storage gateway"', () => {
    render(<LandingPage />);

    expect(screen.getByText('Unified multi-Google Drive storage gateway')).toBeTruthy();
  });

  it('renders the hero sub-paragraph describing OmniDrive', () => {
    render(<LandingPage />);

    expect(
      screen.getByText(/OmniDrive lets you connect multiple Google Drive accounts/i),
    ).toBeTruthy();
  });

  it('renders the "Get started" CTA button linking to /login', () => {
    render(<LandingPage />);

    const cta = screen.getByText('Get started');
    expect(cta).toBeTruthy();
    expect(cta.closest('a')?.getAttribute('href')).toBe('/login');
  });

  it('renders the "View on GitHub" external link', () => {
    render(<LandingPage />);

    const githubLink = screen.getByText('View on GitHub');
    expect(githubLink).toBeTruthy();
    const anchor = githubLink.closest('a');
    expect(anchor?.getAttribute('href')).toBe('https://github.com/james2256/OmniDrive');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the header "Sign in" link to /login', () => {
    render(<LandingPage />);

    const signInLink = screen.getByText('Sign in');
    expect(signInLink).toBeTruthy();
    expect(signInLink.closest('a')?.getAttribute('href')).toBe('/login');
  });

  it('renders the "Features" section heading', () => {
    render(<LandingPage />);

    expect(screen.getByText('Features')).toBeTruthy();
  });

  it('renders all 5 feature titles', () => {
    render(<LandingPage />);

    const expectedTitles = [
      'Multi-Drive Gateway',
      'Team Workspaces',
      'Shared Links',
      'Background Sync',
      'Security First',
    ];
    expectedTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeTruthy();
    });
  });

  it('renders all 5 feature descriptions', () => {
    render(<LandingPage />);

    const expectedDescriptions = [
      'Connect multiple Google Drive accounts and browse all files from one dashboard.',
      'Organize files in workspaces with role-based access control for your team.',
      'Share files with password protection, expiration dates, and download limits.',
      'Automatic sync keeps your file index up to date across connected drives.',
      'OAuth tokens encrypted at rest, CSRF protection, and PKCE authentication flow.',
    ];
    expectedDescriptions.forEach((desc) => {
      expect(screen.getByText(desc)).toBeTruthy();
    });
  });

  it('renders a feature icon per feature card (5 icons total)', () => {
    render(<LandingPage />);

    expect(screen.getAllByTestId('icon-cloud').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('icon-users').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('icon-link2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('icon-folder-sync').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('icon-shield').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Terms of Service and Privacy Policy links (agreement + footer)', () => {
    render(<LandingPage />);

    // "Terms of Service" appears in the agreement section and the footer nav.
    const termsLinks = screen.getAllByText('Terms of Service');
    expect(termsLinks.length).toBeGreaterThanOrEqual(1);
    termsLinks.forEach((link) => {
      expect(link.closest('a')?.getAttribute('href')).toBe('/terms');
    });

    // "Privacy Policy" appears in the agreement section and the footer nav.
    const privacyLinks = screen.getAllByText('Privacy Policy');
    expect(privacyLinks.length).toBeGreaterThanOrEqual(1);
    privacyLinks.forEach((link) => {
      expect(link.closest('a')?.getAttribute('href')).toBe('/privacy');
    });
  });

  it('renders a Contact mailto link in the footer', () => {
    render(<LandingPage />);

    const contactLink = screen.getByText('Contact');
    expect(contactLink).toBeTruthy();
    expect(contactLink.closest('a')?.getAttribute('href')).toBe('mailto:admin@example.com');
  });

  it('renders the copyright line in the footer', () => {
    render(<LandingPage />);

    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} OmniDrive`)).toBeTruthy();
  });
});
