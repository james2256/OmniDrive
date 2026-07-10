import { create } from 'zustand';
import type { Toast, ToastType } from '../types';

const EXIT_DURATION = 300; // must match the animate-out duration in Toast.tsx

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));

    // Auto-remove after 5 seconds
    setTimeout(() => {
      get().removeToast(id);
    }, 5000);
  },

  removeToast: (id: string) => {
    // Mark the toast as removing so the exit animation can play,
    // then actually remove it after the animation duration.
    const toast = get().toasts.find((t) => t.id === id);
    if (!toast || toast.removing) return;

    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, removing: true } : t)),
    }));

    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, EXIT_DURATION);
  },
}));
