import { useEffect } from 'react';
import { useAutomationStore } from '../stores/useAutomationStore';

export function AutomationsPage() {
  const { rules, fetchRules, toggleRule, isLoading, error } = useAutomationStore();

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Automation Rules</h1>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-card border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center text-stone-400">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-3" />
            Loading rules...
          </div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-stone-400">
            No automation rules yet.
          </div>
        ) : (
          rules.map(rule => (
            <div key={rule.id} className="p-4 border-b border-stone-100 last:border-b-0 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-stone-800 mb-1 truncate">
                  {rule.name}
                </h3>
                <p className="text-xs text-stone-500">
                  Trigger: <span className="capitalize">{rule.triggerType}</span>
                </p>
              </div>
              <button
                onClick={() => toggleRule(rule.id, !rule.isActive)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${rule.isActive ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-600'}`}
              >
                {rule.isActive ? 'Active' : 'Inactive'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
