import { create } from 'zustand';

interface Rule {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
}

interface AutomationStore {
  rules: Rule[];
  fetchRules: () => Promise<void>;
  toggleRule: (id: string, is_active: boolean) => Promise<void>;
}

export const useAutomationStore = create<AutomationStore>((set) => ({
  rules: [],
  fetchRules: async () => {
    const res = await fetch('/api/automations', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    set({ rules: data.rules });
  },
  toggleRule: async (id, is_active) => {
    await fetch(`/api/automations/${id}/toggle`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ is_active })
    });
    set((state) => ({
      rules: state.rules.map(r => r.id === id ? { ...r, is_active } : r)
    }));
  }
}));
