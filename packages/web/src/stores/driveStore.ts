import { create } from 'zustand';
import type { DriveAccount, AggregateQuota } from '../types';
import { api } from '../lib/api';

interface DriveState {
  drives: DriveAccount[];
  aggregate: AggregateQuota;
  isLoading: boolean;
  fetchDrives: () => Promise<void>;
  removeDrive: (id: string) => Promise<void>;
  triggerSync: (id: string) => Promise<void>;
}

const emptyAggregate: AggregateQuota = { totalQuota: 0, totalUsed: 0, totalFree: 0, driveCount: 0 };

export const useDriveStore = create<DriveState>((set) => ({
  drives: [],
  aggregate: emptyAggregate,
  isLoading: false,

  fetchDrives: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getDrives();
      set({ drives: data.drives, aggregate: data.aggregate, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  removeDrive: async (id: string) => {
    await api.disconnectDrive(id);
    set((state) => {
      const drives = state.drives.filter((d) => d.id !== id);
      return {
        drives,
        aggregate: {
          totalQuota: drives.reduce((sum, d) => sum + d.totalQuota, 0),
          totalUsed: drives.reduce((sum, d) => sum + d.usedQuota, 0),
          totalFree: drives.reduce((sum, d) => sum + d.freeSpace, 0),
          driveCount: drives.length,
        },
      };
    });
  },

  triggerSync: async (id: string) => {
    await api.triggerSync(id);
  },
}));
