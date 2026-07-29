// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EmptyState, ListSkeleton } from './EmptyState';

// A simple stand-in Lucide icon — EmptyState forwards `size` and `className` to it.
const MockIcon = (props: any) => <svg data-testid="mock-icon" {...props} />;

describe('EmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders the icon and the title', () => {
    render(<EmptyState icon={MockIcon} title="No files yet" />);

    expect(screen.getByTestId('mock-icon')).toBeTruthy();
    expect(screen.getByText('No files yet')).toBeTruthy();
    // Title is wrapped in an <h3>
    expect(screen.getByText('No files yet').tagName).toBe('H3');
  });

  it('renders the description when provided', () => {
    render(
      <EmptyState
        icon={MockIcon}
        title="No files yet"
        description="Upload files to get started."
      />,
    );

    expect(screen.getByText('Upload files to get started.')).toBeTruthy();
  });

  it('does not render the description when omitted', () => {
    render(<EmptyState icon={MockIcon} title="No files yet" />);

    expect(screen.queryByText('Upload files to get started.')).toBeNull();
  });

  it('renders the action when provided', () => {
    render(
      <EmptyState
        icon={MockIcon}
        title="No files yet"
        action={<button data-testid="empty-action">Upload</button>}
      />,
    );

    expect(screen.getByTestId('empty-action')).toBeTruthy();
  });

  it('does not render the action when omitted', () => {
    render(<EmptyState icon={MockIcon} title="No files yet" />);

    expect(screen.queryByTestId('empty-action')).toBeNull();
  });

  it('exposes role="status" on the root container for assistive tech', () => {
    render(<EmptyState icon={MockIcon} title="No files yet" />);

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('passes aria-hidden to the icon and applies the icon className', () => {
    render(<EmptyState icon={MockIcon} title="No files yet" />);

    const icon = screen.getByTestId('mock-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    // Source applies the text-primary class on the icon element.
    expect(icon.getAttribute('class')).toContain('text-primary');
  });
});

describe('ListSkeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders the requested number of rows', () => {
    const { container } = render(<ListSkeleton rows={3} />);

    // Each row is a div with `animate-pulse` class.
    const rows = container.querySelectorAll('.animate-pulse');
    expect(rows).toHaveLength(3);
  });

  it('defaults to 5 rows when rows prop is omitted', () => {
    const { container } = render(<ListSkeleton />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
  });

  it('renders 0 rows when rows={0}', () => {
    const { container } = render(<ListSkeleton rows={0} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  it('exposes aria-busy="true" and aria-label="Loading" on the root container', () => {
    render(<ListSkeleton rows={3} />);

    const root = screen.getByLabelText('Loading');
    expect(root.getAttribute('aria-busy')).toBe('true');
  });
});
