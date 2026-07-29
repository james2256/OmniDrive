// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Breadcrumb } from './Breadcrumb';
import type { BreadcrumbItem } from '../types';

// --- Hoisted navigate spy (Link calls it on click) ---
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, onClick, ...props }: any) => (
    <a
      href={String(to)}
      data-to={String(to)}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        navigate(String(to));
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock('lucide-react', () => ({
  ChevronRight: (props: any) => <svg data-testid="chevron-icon" aria-hidden="true" {...props} />,
}));

const items: BreadcrumbItem[] = [
  { id: 'root', name: 'Files' },
  { id: 'folder-1', name: 'Folder A' },
  { id: 'folder-2', name: 'Folder B' },
];

describe('Breadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders all item names', () => {
    render(<Breadcrumb items={items} />);

    expect(screen.getByText('Files')).toBeTruthy();
    expect(screen.getByText('Folder A')).toBeTruthy();
    expect(screen.getByText('Folder B')).toBeTruthy();
  });

  it('renders separators between items (n-1 chevrons for n items)', () => {
    render(<Breadcrumb items={items} />);

    // 3 items → 2 separators
    expect(screen.getAllByTestId('chevron-icon')).toHaveLength(2);
  });

  it('clicking a non-last item navigates to the corresponding route', () => {
    render(<Breadcrumb items={items} />);

    // First item ("Files") has id="root" → links to "/files"
    fireEvent.click(screen.getByText('Files'));
    expect(navigate).toHaveBeenCalledWith('/files');

    // Second item ("Folder A") has id="folder-1" → links to "/files/folder-1"
    fireEvent.click(screen.getByText('Folder A'));
    expect(navigate).toHaveBeenCalledWith('/files/folder-1');
  });

  it('appends driveId as a query parameter when provided and item is not root', () => {
    render(<Breadcrumb items={items} driveId="drive-7" />);

    // Root link stays "/files" (no query param) — it's a Link (not last).
    expect(screen.getByText('Files').getAttribute('data-to')).toBe('/files');
    // Non-root Link items get the driveId query param.
    expect(screen.getByText('Folder A').getAttribute('data-to')).toBe(
      '/files/folder-1?driveId=drive-7',
    );
    // Last item ("Folder B") is rendered as a span, NOT a Link — no data-to.
    expect(screen.getByText('Folder B').tagName).toBe('SPAN');
    expect(screen.getByText('Folder B').getAttribute('data-to')).toBeNull();
  });

  it('renders many items without truncation (overflow-x-auto container scrolls)', () => {
    const longItems: BreadcrumbItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `folder-${i}`,
      name: `Folder ${i + 1}`,
    }));
    render(<Breadcrumb items={longItems} />);

    // All 10 items remain rendered (the nav uses overflow-x-auto, not truncation)
    longItems.forEach((item) => {
      expect(screen.getByText(item.name)).toBeTruthy();
    });
    expect(screen.getAllByTestId('chevron-icon')).toHaveLength(9);
  });

  it('handles empty items (renders nothing)', () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles a single item (no separators, last item is a span with aria-current)', () => {
    render(<Breadcrumb items={[items[0]]} />);

    // No separators for a single item
    expect(screen.queryAllByTestId('chevron-icon')).toHaveLength(0);
    // Last (and only) item is a span, not a link — has aria-current="page"
    const lastItem = screen.getByText('Files');
    expect(lastItem.tagName).toBe('SPAN');
    expect(lastItem.getAttribute('aria-current')).toBe('page');
  });

  it('marks the last item as the current page with aria-current="page"', () => {
    render(<Breadcrumb items={items} />);

    const last = screen.getByText('Folder B');
    expect(last.tagName).toBe('SPAN');
    expect(last.getAttribute('aria-current')).toBe('page');
  });

  it('exposes aria-label="Folder navigation" on the nav element', () => {
    render(<Breadcrumb items={items} />);

    expect(screen.getByLabelText('Folder navigation')).toBeTruthy();
  });
});
