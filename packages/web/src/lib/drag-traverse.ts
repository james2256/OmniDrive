/**
 * Traverse a dropped FileSystemDirectoryEntry and collect all files with
 * their relative paths set on webkitRelativePath (matching the <input
 * webkitdirectory> contract). Empty subfolders are also collected so the
 * caller can ensure they exist on the target drive (Fix 2).
 *
 * Uses the FileSystemEntry API (webkitGetAsEntry). Supported by all
 * evergreen browsers (Chrome, Firefox, Safari, Edge) — per MDN, even
 * non-WebKit browsers implement it under the webkit prefix.
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry
 */

interface TraversedFile extends File {
  webkitRelativePath: string;
}

interface TraversalResult {
  files: TraversedFile[];
  /** All directory paths discovered, including empty ones. Slash-separated, relative to drop root. */
  directoryPaths: string[];
}

/** Read all entries from a directory reader (handles pagination via readEntries). */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(entries);
        else {
          entries.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Recursively traverse a directory entry, collecting files and directory paths. */
async function traverseDirectoryEntry(
  entry: FileSystemDirectoryEntry,
  prefix: string,
  result: TraversalResult,
): Promise<void> {
  const currentPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  result.directoryPaths.push(currentPath);

  const reader = entry.createReader();
  const entries = await readAllEntries(reader);

  for (const child of entries) {
    if (child.isDirectory) {
      await traverseDirectoryEntry(child as FileSystemDirectoryEntry, currentPath, result);
    } else if (child.isFile) {
      const file = await entryToFile(child as FileSystemFileEntry);
      // Set webkitRelativePath so useUploadStore.resolveParentItem works.
      // The standard File interface doesn't include this, but <input webkitdirectory>
      // sets it — we replicate the contract for drag-drop parity.
      Object.defineProperty(file, 'webkitRelativePath', {
        value: `${currentPath}/${file.name}`,
        writable: false,
      });
      result.files.push(file as TraversedFile);
    }
  }
}

/**
 * Traverse all dropped items via DataTransfer. If an item is a directory,
 * recurse into it. If it's a file, include it directly (flat, no relative
 * path — matches react-dropzone's existing behavior for file drops).
 *
 * Returns files with webkitRelativePath set (for folder drops) and all
 * discovered directory paths (including empty folders, for Fix 2).
 */
export async function traverseDroppedItems(dataTransfer: DataTransfer): Promise<TraversalResult> {
  const result: TraversalResult = { files: [], directoryPaths: [] };
  const items = Array.from(dataTransfer.items);

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (!entry) {
      // Fallback: no FileSystemEntry support — use the File directly.
      const file = item.getAsFile();
      if (file) result.files.push(file as TraversedFile);
      continue;
    }
    if (entry.isDirectory) {
      await traverseDirectoryEntry(entry as FileSystemDirectoryEntry, '', result);
    } else if (entry.isFile) {
      const file = await entryToFile(entry as FileSystemFileEntry);
      result.files.push(file as TraversedFile);
    }
  }

  return result;
}
