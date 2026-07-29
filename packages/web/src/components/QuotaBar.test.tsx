// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QuotaBar } from './QuotaBar';

// Helper: get the colored bar div (the only element with the "transition-all" class).
function getBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('.transition-all');
  if (!bar) throw new Error('bar element not rendered');
  return bar as HTMLElement;
}

describe('QuotaBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders the used and total labels with formatted file sizes', () => {
    render(<QuotaBar used={500} total={1024} />);

    // formatFileSize(500) = "500 B"; formatFileSize(1024) = "1.0 KB"
    expect(screen.getByText('500 B used')).toBeTruthy();
    expect(screen.getByText('1.0 KB total')).toBeTruthy();
  });

  it('hides the labels when showLabel is false', () => {
    render(<QuotaBar used={500} total={1024} showLabel={false} />);

    expect(screen.queryByText('500 B used')).toBeNull();
    expect(screen.queryByText('1.0 KB total')).toBeNull();
  });

  it('formats bytes to KB / MB / GB via formatFileSize', () => {
    render(<QuotaBar used={1048576} total={1073741824} />);

    expect(screen.getByText('1.0 MB used')).toBeTruthy();
    expect(screen.getByText('1.0 GB total')).toBeTruthy();
  });

  it('formats 0 bytes as "0 B"', () => {
    render(<QuotaBar used={0} total={0} />);

    expect(screen.getByText('0 B used')).toBeTruthy();
    expect(screen.getByText('0 B total')).toBeTruthy();
  });

  it('sets the inner bar width to the percentage (used/total * 100)', () => {
    const { container } = render(<QuotaBar used={250} total={1000} />);
    const bar = getBar(container);
    // 250/1000 * 100 = 25%
    expect(bar.style.width).toBe('25%');
  });

  it('caps the inner bar width at 100% when used exceeds total', () => {
    const { container } = render(<QuotaBar used={1500} total={1000} />);
    const bar = getBar(container);
    // Math.min(150, 100) = 100
    expect(bar.style.width).toBe('100%');
  });

  it('sets the bar width to 0% when total is 0 (avoids div-by-zero)', () => {
    const { container } = render(<QuotaBar used={500} total={0} />);
    const bar = getBar(container);
    expect(bar.style.width).toBe('0%');
  });

  it('uses the blue (#2563EB) color when usage is below the warning threshold (<75%)', () => {
    const { container } = render(<QuotaBar used={250} total={1000} />);
    const bar = getBar(container);
    // jsdom normalizes hex colors to rgb() on read-back.
    expect(bar.style.backgroundColor).toBe('rgb(37, 99, 235)');
  });

  it('uses the yellow (#f59e0b) color when usage is in the warning range (75%–89%)', () => {
    const { container } = render(<QuotaBar used={800} total={1000} />);
    const bar = getBar(container);
    expect(bar.style.backgroundColor).toBe('rgb(245, 158, 11)');
  });

  it('uses the red (#ef4444) color when usage is in the danger range (>=90%)', () => {
    const { container } = render(<QuotaBar used={950} total={1000} />);
    const bar = getBar(container);
    expect(bar.style.backgroundColor).toBe('rgb(239, 68, 68)');
  });

  it('uses red exactly at the 90% danger threshold', () => {
    const { container } = render(<QuotaBar used={900} total={1000} />);
    const bar = getBar(container);
    expect(bar.style.backgroundColor).toBe('rgb(239, 68, 68)');
  });

  it('uses yellow exactly at the 75% warning threshold', () => {
    const { container } = render(<QuotaBar used={750} total={1000} />);
    const bar = getBar(container);
    expect(bar.style.backgroundColor).toBe('rgb(245, 158, 11)');
  });

  it('uses a custom color when the color prop is provided (overrides threshold color)', () => {
    const { container } = render(<QuotaBar used={950} total={1000} color="#abcdef" />);
    const bar = getBar(container);
    expect(bar.style.backgroundColor).toBe('rgb(171, 205, 239)');
  });

  it('defaults showLabel to true', () => {
    render(<QuotaBar used={250} total={1024} />);
    // Labels visible by default; formatFileSize(1024) = "1.0 KB".
    expect(screen.getByText('250 B used')).toBeTruthy();
    expect(screen.getByText('1.0 KB total')).toBeTruthy();
  });
});
