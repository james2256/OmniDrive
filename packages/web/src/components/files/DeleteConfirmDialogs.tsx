import { ConfirmDialog } from '../ConfirmDialog';

interface Props {
  mode: 'soft' | 'permanent';
  confirmFile: { id: string; name: string } | null;
  confirmFolder: { id: string; name: string } | null;
  fileLoading: boolean;
  folderLoading: boolean;
  onConfirmFile: (id: string) => Promise<void>;
  onConfirmFolder: (id: string) => Promise<void>;
  onCloseFile: () => void;
  onCloseFolder: () => void;
}

/**
 * Shared delete-confirmation dialog pair (file + folder).
 * Fixes Bug 3 (loading dead code): onConfirm is async — the dialog stays
 * open with a spinner until the mutation settles.
 * Fixes Bug 5 (StarredPage): drop-in replacement gives StarredPage
 * confirmation dialogs it was missing entirely.
 */
export function DeleteConfirmDialogs({
  mode,
  confirmFile,
  confirmFolder,
  fileLoading,
  folderLoading,
  onConfirmFile,
  onConfirmFolder,
  onCloseFile,
  onCloseFolder,
}: Props) {
  const isPermanent = mode === 'permanent';
  return (
    <>
      <ConfirmDialog
        open={!!confirmFile}
        title={isPermanent ? 'Permanently delete file' : 'Delete file'}
        message={
          isPermanent
            ? `Permanently delete "${confirmFile?.name}"? This cannot be undone.`
            : `Move "${confirmFile?.name}" to trash?`
        }
        confirmText={isPermanent ? 'Delete Forever' : 'Delete'}
        variant="danger"
        loading={fileLoading}
        onConfirm={async () => {
          if (confirmFile) await onConfirmFile(confirmFile.id);
        }}
        onClose={onCloseFile}
      />
      <ConfirmDialog
        open={!!confirmFolder}
        title={isPermanent ? 'Permanently delete folder' : 'Delete folder'}
        message={
          isPermanent
            ? `Permanently delete "${confirmFolder?.name}" and all contents? This cannot be undone.`
            : `Move "${confirmFolder?.name}" to trash? All contents will be moved to Google Drive trash.`
        }
        confirmText={isPermanent ? 'Delete Forever' : 'Delete'}
        variant="danger"
        loading={folderLoading}
        onConfirm={async () => {
          if (confirmFolder) await onConfirmFolder(confirmFolder.id);
        }}
        onClose={onCloseFolder}
      />
    </>
  );
}
