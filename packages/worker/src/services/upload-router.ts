import type { DriveWithQuota } from '../types/domain';
import { ValidationError, NotFoundError } from '../lib/errors';

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
      throw new ValidationError('No connected Drive accounts available');
    }

    if (preferredDriveId) {
      const drive = this.drives.find((d) => d.id === preferredDriveId);
      if (!drive) {
        throw new NotFoundError('Preferred drive account not found');
      }
      if (this.fits(drive, fileSize)) {
        return drive;
      }
      // Preferred drive is full: fall through to spillover instead of failing.
    }

    // Auto-select / spillover: sort unlimited drives first (they always fit),
    // then by freeSpace desc. The operand order is critical —
    // `(b.isUnlimited ? 1 : 0) - (a.isUnlimited ? 1 : 0)` sorts unlimited to
    // the front. The inverted form `(a... - b...)` would sort unlimited LAST,
    // and since only sorted[0] is fit-checked, an unlimited drive would never
    // be selected (A-1, probe-proven S1/S3).
    const sorted = [...this.drives].sort(
      (a, b) => (b.isUnlimited ? 1 : 0) - (a.isUnlimited ? 1 : 0) || b.freeSpace - a.freeSpace,
    );
    const bestDrive = sorted[0];

    if (!this.fits(bestDrive, fileSize)) {
      throw new ValidationError('Insufficient overall quota for this file');
    }

    return bestDrive;
  }

  /**
   * A drive fits an upload if it's confirmed-unlimited (isUnlimited) OR has
   * enough free space. isUnlimited is only true when live Google data
   * confirmed the absence of a limit — a stored-only fallback has
   * isUnlimited=false and is excluded from auto-selection until live quota is
   * re-fetched (A-6b provenance: prevents routing oversized uploads onto
   * unconfirmed finite drives). Stale clients (isUnlimited undefined) fall
   * through to the freeSpace check.
   */
  private fits(drive: DriveWithQuota, fileSize: number): boolean {
    return drive.isUnlimited || drive.freeSpace >= fileSize;
  }
}
