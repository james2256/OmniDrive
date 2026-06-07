import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Header } from './Header';

describe('Header', () => {
  it('renders OmniDrive branding', () => {
    render(<Header />);
    expect(screen.getByText('OmniDrive')).toBeDefined();
  });
});
