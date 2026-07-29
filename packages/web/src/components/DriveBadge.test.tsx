// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DriveBadge } from './DriveBadge';

// Helper: get the outer badge span (the one with the border + color styles).
// Uses the aria-hidden dot's parent — robust whether or not `email` is set
// (title is omitted when email is null, so we can't rely on [title]).
function getBadge(container: HTMLElement): HTMLElement {
  const dot = container.querySelector('[aria-hidden="true"]');
  if (!dot || !dot.parentElement) throw new Error('badge element not rendered');
  return dot.parentElement as HTMLElement;
}

// Helper: get the inner color dot span (aria-hidden).
function getDot(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[aria-hidden="true"]');
  if (!el) throw new Error('dot element not rendered');
  return el as HTMLElement;
}

// Helper: get the label span (has `truncate` class).
function getLabelSpan(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.truncate');
  if (!el) throw new Error('label span not rendered');
  return el as HTMLElement;
}

describe('DriveBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders the email in the title attribute and the formatted label in body', () => {
    const { container } = render(<DriveBadge email="john@example.com" colorIndex={0} />);

    const badge = getBadge(container);
    expect(badge.getAttribute('title')).toBe('john@example.com');
    // formatDriveLabel("john@example.com") = "john" (local part ≤ 16 chars)
    expect(getLabelSpan(container).textContent).toBe('john');
  });

  it('renders "Unknown" when email is null', () => {
    const { container } = render(<DriveBadge email={null} colorIndex={0} />);

    expect(getLabelSpan(container).textContent).toBe('Unknown');
    // title is omitted when email is null (source: `title={email ?? undefined}`)
    const badge = getBadge(container);
    expect(badge.getAttribute('title')).toBeNull();
  });

  it('renders "Unknown" when email is undefined', () => {
    const { container } = render(<DriveBadge colorIndex={0} />);

    expect(getLabelSpan(container).textContent).toBe('Unknown');
  });

  it('returns the local part when the email has a @ (≤16 chars)', () => {
    const { container } = render(<DriveBadge email="alice@bar.com" colorIndex={0} />);
    expect(getLabelSpan(container).textContent).toBe('alice');
  });

  it('truncates a long local part (>16 chars) to first 14 chars + ellipsis', () => {
    const { container } = render(
      <DriveBadge email="verylonglocalpart@example.com" colorIndex={0} />,
    );

    // "verylonglocalpart" is 17 chars → truncated to "verylonglocalp" + "…"
    expect(getLabelSpan(container).textContent).toBe('verylonglocalp…');
  });

  it('keeps the full local part when exactly 16 chars (≤16 boundary)', () => {
    const { container } = render(
      <DriveBadge email="exactly16charsss@example.com" colorIndex={0} />,
    );

    // "exactly16charsss" is 16 chars → NOT truncated
    expect(getLabelSpan(container).textContent).toBe('exactly16charsss');
  });

  it('returns the full email when no @ is present', () => {
    const { container } = render(<DriveBadge email="nosymbol" colorIndex={0} />);

    // at = -1 (not > 0) → local = email (full string)
    expect(getLabelSpan(container).textContent).toBe('nosymbol');
  });

  it('uses the getDriveColor CSS var for colorIndex >= 0', () => {
    const { container } = render(<DriveBadge email="a@b.com" colorIndex={0} />);

    const badge = getBadge(container);
    // getDriveColor(0) = 'var(--drive-1)'
    expect(badge.style.color).toBe('var(--drive-1)');
    expect(badge.style.borderColor).toBe('var(--drive-1)');
    // Dot also gets the same color as background.
    expect(getDot(container).style.backgroundColor).toBe('var(--drive-1)');
  });

  it('cycles drive colors modulo 5', () => {
    const { container: c0 } = render(<DriveBadge email="a@b.com" colorIndex={0} />);
    const { container: c1 } = render(<DriveBadge email="a@b.com" colorIndex={1} />);
    const { container: c5 } = render(<DriveBadge email="a@b.com" colorIndex={5} />);

    expect(getBadge(c0).style.color).toBe('var(--drive-1)');
    expect(getBadge(c1).style.color).toBe('var(--drive-2)');
    // 5 % 5 = 0 → var(--drive-1)
    expect(getBadge(c5).style.color).toBe('var(--drive-1)');
  });

  it('uses the neutral grey color when colorIndex is negative', () => {
    const { container } = render(<DriveBadge email="a@b.com" colorIndex={-1} />);

    // jsdom normalizes hex colors to rgb() on read-back.
    const badge = getBadge(container);
    expect(badge.style.color).toBe('rgb(148, 163, 184)');
    expect(badge.style.borderColor).toBe('rgb(148, 163, 184)');
    expect(getDot(container).style.backgroundColor).toBe('rgb(148, 163, 184)');
  });

  it('defaults to the sm size variant', () => {
    const { container } = render(<DriveBadge email="a@b.com" colorIndex={0} />);

    const badge = getBadge(container);
    expect(badge.className).toContain('text-[10px]');
    expect(badge.className).toContain('max-w-[150px]');
    // Dot is the small w-2 h-2 size.
    expect(getDot(container).className).toContain('w-2 h-2');
  });

  it('applies the md size variant', () => {
    const { container } = render(<DriveBadge email="a@b.com" colorIndex={0} size="md" />);

    const badge = getBadge(container);
    expect(badge.className).toContain('text-xs');
    expect(badge.className).toContain('max-w-[180px]');
    // Dot is the larger w-2.5 h-2.5 size.
    expect(getDot(container).className).toContain('w-2.5 h-2.5');
  });

  it('applies max-width truncation (truncate class on label span)', () => {
    const { container } = render(<DriveBadge email="alice@example.com" colorIndex={0} />);

    expect(getLabelSpan(container).className).toContain('truncate');
  });

  it('applies an additional className to the badge', () => {
    const { container } = render(
      <DriveBadge email="a@b.com" colorIndex={0} className="my-custom-class" />,
    );

    expect(getBadge(container).className).toContain('my-custom-class');
  });

  it('marks the color dot as aria-hidden', () => {
    const { container } = render(<DriveBadge email="a@b.com" colorIndex={0} />);

    expect(getDot(container).getAttribute('aria-hidden')).toBe('true');
  });
});
