import { useEffect } from 'react';
import { useAutomationStore } from '../stores/useAutomationStore';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/EmptyState';
import { Zap } from 'lucide-react';

export function AutomationsPage() {
  const { rules, fetchRules, toggleRule, isLoading, error } = useAutomationStore();

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  return (
    <div className="p-4 sm:p-6 space-y-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-800">Automation Rules</h1>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg mb-4 text-sm">{error}</div>}

      <div className="bg-card border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-3" />
            Loading rules...
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No automation rules"
            description="Create a rule to automate file actions."
          />
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="p-4 border-b border-slate-100 last:border-b-0 flex justify-between items-center gap-3"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 mb-1 truncate">{rule.name}</h3>
                <p className="text-xs text-slate-500">
                  Trigger: <span className="capitalize">{rule.triggerType}</span>
                </p>
              </div>
              <Button
                onClick={() => toggleRule(rule.id, !rule.isActive)}
                variant={rule.isActive ? 'primary' : 'ghost'}
                className={`rounded-lg text-xs flex-shrink-0 ${!rule.isActive ? 'bg-slate-100 hover:bg-slate-100' : ''}`}
              >
                {rule.isActive ? 'Active' : 'Inactive'}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
