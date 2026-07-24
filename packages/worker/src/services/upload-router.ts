import type { DriveWithQuota } from '../types/index';
import { AppError } from '../lib/errors';

export class UploadRouter {
  constructor(private drives: DriveWithQuota[]) {}

  /**
   * Selects the best drive account for a new upload.
   * Logic:
   * 1. If preferredDriveId is provided and has room, use it.
   * 2. Otherwise (no preference, or preferred is full) spill over to the
   *    drive with the most absolute free space.
   * ponytail: no single drive fits => throw. Cross-drive split is striping (skipped).
   */
  selectDriveForUpload(fileSize: number, preferredDriveId?: string): DriveWithQuota {
    if (this.drives.length === 0) {
      throw new AppError(400, 'No connected Drive accounts available');
    }

    if (preferredDriveId) {
      const drive = this.drives.find((d) => d.id === preferredDriveId);
      if (!drive) {
        throw new AppError(404, 'Preferred drive account not found');
      }
      if (drive.freeSpace >= fileSize) {
        return drive;
      }
      // Preferred drive is full: fall through to spillover instead of failing.
    }

    // Auto-select / spillover: pick the drive with the most free space.
    const sorted = [...this.drives].sort((a, b) => b.freeSpace - a.freeSpace);
    const bestDrive = sorted[0];

    if (bestDrive.freeSpace < fileSize) {
      throw new AppError(400, 'Insufficient overall quota for this file');
    }

    return bestDrive;
  }
}
