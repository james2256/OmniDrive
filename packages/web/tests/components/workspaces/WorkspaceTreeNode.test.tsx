// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkspaceTreeNode } from '../../../src/components/workspaces/WorkspaceTreeNode';
import type { WorkspaceFolder } from '../../../src/types';

describe('WorkspaceTreeNode', () => {
  const mockFolder: WorkspaceFolder = {
    id: '1',
    name: 'Engineering',
    workspaceId: 'w1',
    parentId: null,
    icon: null,
    color: null,
    isStarred: false,
    createdAt: '',
    updatedAt: '',
  };
  const mockChild: WorkspaceFolder = {
    id: '2',
    name: 'Child',
    workspaceId: 'w1',
    parentId: '1',
    icon: null,
    color: null,
    isStarred: false,
    createdAt: '',
    updatedAt: '',
  };

  it('renders and responds to clicks', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const childrenMap = new Map<string | null, WorkspaceFolder[]>();
    childrenMap.set('1', [mockChild]);

    render(
      <WorkspaceTreeNode
        folder={mockFolder}
        level={0}
        activeFolderId={null}
        expandedIds={new Set()}
        childrenMap={childrenMap}
        onSelect={onSelect}
        onToggle={onToggle}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onNewSubfolder={vi.fn()}
      />,
    );

    // Toggle click
    fireEvent.click(screen.getByTestId('tree-node-toggle-1'));
    expect(onToggle).toHaveBeenCalledWith('1');

    // Select click
    fireEvent.click(screen.getByText('Engineering'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });
});
