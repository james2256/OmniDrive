# Move to Another Drive - Design Spec

## Overview
This feature allows a user to move an individual file from one connected Google Drive account to another connected Google Drive account, entirely through the Omnidrive interface. To avoid downloading and uploading file contents through Cloudflare Workers (which has strict time and memory limits), the actual file transfer is handled server-side directly between the Google Drive accounts using a Share -> Copy -> Delete flow.

## 1. UI and API Contract

### Frontend UI
- **Context Menu:** A new "Move to another drive" option will be added to the file action context menu (e.g., three-dots menu on a file item) in the unified file browser.
- **Move Modal:** Clicking this option opens a modal. This modal fetches and displays a list of all connected `drive_accounts` belonging to the user, strictly excluding the drive where the file currently resides.
- **Loading State:** Upon selecting a target drive and clicking confirm, the modal will display a loading spinner. The UI will prevent the user from making other changes to this file while the operation is in progress.
- **Success State:** Once the API call completes successfully, the modal closes, a success toast appears, and the file's drive icon/badge updates to reflect the new target drive. The file's position within Omnidrive's Virtual Folder structure remains unchanged.

### API Contract
- **Endpoint:** `POST /api/files/:id/move`
- **Payload:** 
  ```json
  {
    "targetDriveId": "string (the ID of the destination drive account)"
  }
  ```
- **Response:** Returns the fully updated file object (containing the new `drive_account_id` and the new `google_file_id`).

## 2. Backend Architecture and Data Flow

The `POST /api/files/:id/move` endpoint handles the move synchronously via the following steps:

1. **Validation:** 
   - Verify that the user is authenticated.
   - Verify that the user owns the source file (by `:id`).
   - Verify that the user owns the target drive account (by `targetDriveId`).
2. **Google Drive API Operations (The Move):**
   - **Step A (Share):** The Worker uses the Source Drive's OAuth credentials to share the source file, granting `writer` permissions specifically to the Target Drive's email address.
   - **Step B (Copy):** The Worker uses the Target Drive's OAuth credentials to call the Google Drive `copy` API on the shared file's ID. This creates a brand new, exact duplicate file that physically resides in the Target Drive.
   - **Step C (Trash):** The Worker uses the Source Drive's OAuth credentials to move the original file into the trash.
3. **Database Operations (D1):**
   - Update the `files` table for the moved file:
     - Set `drive_account_id` to the new `targetDriveId`.
     - Set `google_file_id` to the ID returned from the Copy operation.
     - Set `google_parent_id` to the target drive's root folder ID (or null, depending on Drive's copy behavior).
     - Update `synced_at` timestamp.
   - Keep the existing `virtual_folder_id` intact so the file does not move within the user's Omnidrive virtual directory structure.

## 3. Error Handling & Edge Cases

- **Target Drive Full:** If the target drive does not have enough free storage space, the Google API `copy` operation (Step B) will fail. If this happens, the Worker will catch the error, attempt to revoke the share permission granted in Step A, and immediately return an HTTP 400 or 500 error ("Target drive is full" or similar) to the frontend. No database changes will occur.
- **Trash Failure:** If the copy succeeds but moving the original file to the trash (Step C) fails, the Worker will log a warning but will still update the D1 database to point to the new successful copy. This is treated as a success for the user, effectively acting as a copy operation, ensuring no data loss occurs.
- **Large Files/Timeout Risk:** Because the bytes are transferred internally by Google and not through the Cloudflare Worker, the operation relies purely on Google API response times. This should be fast enough to comfortably complete within the Worker's maximum execution limit, even for very large files.
