import { FilePreviewModal } from '../FilePreviewModal';
import { ShareModal } from '../ShareModal';
import { MoveDriveModal } from '../MoveDriveModal';
import { MoveModal } from '../MoveModal';
import { FolderDownloadModal } from '../FolderDownloadModal';
import { AddToWorkspaceModal } from '../workspaces/AddToWorkspaceModal';
import { RenameDialog } from '../RenameDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToastStore } from '../../stores/useToastStore';
import { useSelectionStore } from '../../stores/useSelectionStore';
import type { UseItemModalsResult } from '../../hooks/useItemModals';

interface Props {
  modals: UseItemModalsResult;
  /** Drive ID for MoveModal (the current drive context). */
  driveId: string;
  /** Refresh callback for modal onSuccess handlers. */
  onRefresh: () => void;
}

/**
 * Renders all file/folder modals driven by useItemModals state.
 * Shared across FilesPage, StarredPage, ExternalPage, WorkspacesPage.
 *
 * The hook owns state + handlers + mutations; this component owns the modal JSX.
 * ConfirmDialog onConfirm calls the exposed confirm handlers (not the mutation
 * directly) so the mutation stays encapsulated in the hook.
 */
export function ItemModals({ modals, driveId, onRefresh }: Props) {
  const { addToast } = useToastStore();
  const { clearSelection } = useSelectionStore();

  return (
    <>
      <FilePreviewModal
        open={!!modals.previewFile}
        file={modals.previewFile ?? undefined}
        onClose={() => modals.setPreviewFile(null)}
      />
      <ShareModal
        open={!!modals.shareTarget}
        targetType={modals.shareTarget?.type ?? 'file'}
        targetId={modals.shareTarget?.id ?? ''}
        onClose={() => modals.setShareTarget(null)}
      />
      {/* MoveDriveModal is always mounted (no conditional) so the Radix Dialog
          enter animation plays. It derives `open` from files.length > 0 internally. */}
      <MoveDriveModal
        files={modals.moveDriveFiles}
        onClose={() => modals.setMoveDriveFiles([])}
        onSuccess={() => {
          modals.setMoveDriveFiles([]);
          clearSelection();
          onRefresh();
        }}
      />
      <MoveModal
        open={modals.moveTarget.length > 0}
        items={modals.moveTarget}
        driveId={driveId}
        onClose={() => modals.setMoveTarget([])}
        onSuccess={() => {
          clearSelection();
          onRefresh();
        }}
      />
      <FolderDownloadModal
        open={modals.folderDownloadTarget !== null}
        onClose={() => modals.setFolderDownloadTarget(null)}
        driveId={modals.folderDownloadTarget?.driveId}
        folderId={modals.folderDownloadTarget?.folderId}
        folderName={modals.folderDownloadTarget?.name ?? ''}
      />
      <AddToWorkspaceModal
        open={!!modals.workspaceTarget}
        file={modals.workspaceTarget ?? undefined}
        onClose={() => modals.setWorkspaceTarget(null)}
        onSuccess={() => {
          modals.setWorkspaceTarget(null);
          addToast('success', 'Added to workspace');
          onRefresh();
        }}
      />
      <RenameDialog
        open={modals.renameTarget !== null}
        initialName={modals.renameTarget?.currentName ?? ''}
        title={modals.renameTarget?.kind === 'folder' ? 'Rename Folder' : 'Rename File'}
        loading={modals.isRenaming}
        onConfirm={modals.handleRenameConfirm}
        onClose={modals.closeRename}
      />
      <ConfirmDialog
        open={modals.confirmFileDelete !== null}
        title="Delete File"
        message={
          modals.confirmFileDelete
            ? `Delete "${modals.confirmFileDelete.name}" permanently from Google Drive?`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={modals.isDeletingFile}
        onConfirm={modals.confirmFileDeleteAsync}
        onClose={modals.closeFileDelete}
      />
      <ConfirmDialog
        open={modals.confirmFolderDelete !== null}
        title="Delete Folder"
        message={
          modals.confirmFolderDelete
            ? `Delete "${modals.confirmFolderDelete.name}" and ALL its contents from Google Drive?`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={modals.isDeletingFolder}
        onConfirm={modals.confirmFolderDeleteAsync}
        onClose={modals.closeFolderDelete}
      />
    </>
  );
}
