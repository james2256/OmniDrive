// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DropZone } from './DropZone';

// --- Hoisted mocks ---
const { addFiles, setEmptyFolders, useUploadStoreMock, useDropzoneMock, dropzoneApi } = vi.hoisted(
  () => {
    const addFiles = vi.fn();
    const setEmptyFolders = vi.fn();
    const useUploadStoreMock = vi.fn((selector: any) =>
      selector ? selector({ addFiles, setEmptyFolders }) : { addFiles, setEmptyFolders },
    );

    const dropzoneApi: any = {
      onDropCapture: null as ((f: File[]) => void) | null,
      getFilesFromEventCapture: null as ((e: any) => Promise<any[]>) | null,
      inputClickSpy: vi.fn(),
    };
    const useDropzoneMock = vi.fn((opts: any): any => {
      dropzoneApi.onDropCapture = opts.onDrop;
      dropzoneApi.getFilesFromEventCapture = opts.getFilesFromEvent;
      return {
        getRootProps: () => ({ role: 'presentation' }),
        getInputProps: () => ({
          type: 'file',
          multiple: true,
          onClick: dropzoneApi.inputClickSpy,
          style: { display: 'none' },
        }),
        isDragActive: false,
      };
    });

    return { addFiles, setEmptyFolders, useUploadStoreMock, useDropzoneMock, dropzoneApi };
  },
);

vi.mock('../stores/useUploadStore', () => ({ useUploadStore: useUploadStoreMock }));

vi.mock('react-dropzone', () => ({ useDropzone: useDropzoneMock }));

vi.mock('lucide-react', () => ({
  FolderUp: (props: any) => <svg data-testid="folder-up-icon" {...props} />,
}));

// Mock traverseDroppedItems — the traversal logic is tested separately in drag-traverse tests.
vi.mock('../lib/drag-traverse', () => ({
  traverseDroppedItems: vi.fn(async (dt: DataTransfer) => {
    const files: File[] = [];
    const directoryPaths: string[] = [];
    // Simulate traversal: extract files from the mock DataTransfer's items
    for (const item of Array.from(dt.items)) {
      const file = item.getAsFile?.();
      if (file) files.push(file);
    }
    return { files, directoryPaths };
  }),
}));

describe('DropZone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropzoneApi.onDropCapture = null;
    dropzoneApi.getFilesFromEventCapture = null;
    useDropzoneMock.mockImplementation((opts: any) => {
      dropzoneApi.onDropCapture = opts.onDrop;
      dropzoneApi.getFilesFromEventCapture = opts.getFilesFromEvent;
      return {
        getRootProps: () => ({ role: 'presentation' }),
        getInputProps: () => ({
          type: 'file',
          multiple: true,
          onClick: dropzoneApi.inputClickSpy,
          style: { display: 'none' },
        }),
        isDragActive: false,
      };
    });
  });

  afterEach(() => cleanup());

  it('renders its children', () => {
    render(
      <DropZone>
        <div data-testid="child">Hello world</div>
      </DropZone>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('renders the hidden file input via getInputProps', () => {
    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );

    const input = screen.getByRole('presentation').querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input?.hasAttribute('multiple')).toBe(true);
  });

  it('passes noClick:true and noKeyboard:true to useDropzone', () => {
    render(
      <DropZone>
        <span>x</span>
      </DropZone>,
    );

    expect(useDropzoneMock).toHaveBeenCalledTimes(1);
    const opts = (useDropzoneMock as Mock).mock.calls[0][0];
    expect(opts.noClick).toBe(true);
    expect(opts.noKeyboard).toBe(true);
    expect(typeof opts.onDrop).toBe('function');
  });

  it('passes a getFilesFromEvent function to useDropzone', () => {
    render(
      <DropZone>
        <span>x</span>
      </DropZone>,
    );

    const opts = (useDropzoneMock as Mock).mock.calls[0][0];
    expect(typeof opts.getFilesFromEvent).toBe('function');
  });

  it('highlights with "Drop files or folders to upload" overlay when isDragActive is true', () => {
    useDropzoneMock.mockImplementation((opts: any) => {
      dropzoneApi.onDropCapture = opts.onDrop;
      return {
        getRootProps: () => ({ role: 'presentation' }),
        getInputProps: () => ({}),
        isDragActive: true,
      };
    });

    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );

    expect(screen.getByText('Drop files or folders to upload')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('does NOT highlight when isDragActive is false', () => {
    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );

    expect(screen.queryByText('Drop files or folders to upload')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('drop calls addFiles with the accepted files', () => {
    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );
    expect(dropzoneApi.onDropCapture).not.toBeNull();

    const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
    const fileB = new File(['b'], 'b.txt', { type: 'text/plain' });
    dropzoneApi.onDropCapture!([fileA, fileB]);

    expect(addFiles).toHaveBeenCalledTimes(1);
    expect(addFiles).toHaveBeenCalledWith([fileA, fileB]);
  });

  it('drop does NOT call addFiles when no files are dropped', () => {
    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );

    dropzoneApi.onDropCapture!([]);

    expect(addFiles).not.toHaveBeenCalled();
  });

  it('uses addFiles and setEmptyFolders selectors from useUploadStore', () => {
    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );

    // useUploadStore is called twice: once for addFiles, once for setEmptyFolders
    expect(useUploadStoreMock).toHaveBeenCalledTimes(2);
    const selectors = (useUploadStoreMock as Mock).mock.calls.map((c) => c[0]);
    expect(selectors.every((s) => typeof s === 'function')).toBe(true);
    // Both selectors should resolve from state
    expect(selectors[0]({ addFiles, setEmptyFolders })).toBe(addFiles);
    expect(selectors[1]({ addFiles, setEmptyFolders })).toBe(setEmptyFolders);
  });

  it('clicking the dropzone does NOT trigger file picker (noClick: true)', () => {
    render(
      <DropZone>
        <span>content</span>
      </DropZone>,
    );

    const root = screen.getByRole('presentation');
    fireEvent.click(root);

    expect(dropzoneApi.inputClickSpy).not.toHaveBeenCalled();
  });
});
