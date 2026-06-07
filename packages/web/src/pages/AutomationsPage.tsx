import { useEffect } from 'react';
import { useAutomationStore } from '../stores/useAutomationStore';

export function AutomationsPage() {
  const { rules, fetchRules, toggleRule, isLoading, error } = useAutomationStore();

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-xl)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Automation Rules</h1>
      </div>

      {error && (
        <div style={{ padding: 'var(--space-md)', background: 'var(--accent-danger-subtle)', color: 'var(--accent-danger)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-md)' }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <div className="spinner" style={{ margin: '0 auto', marginBottom: 'var(--space-md)' }} />
            Loading rules...
          </div>
        ) : rules.length === 0 ? (
          <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No automation rules yet.
          </div>
        ) : (
          rules.map(rule => (
            <div key={rule.id} style={{ 
              padding: 'var(--space-md) var(--space-lg)', 
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {rule.name}
                </h3>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>
                  Trigger: <span style={{ textTransform: 'capitalize' }}>{rule.triggerType}</span>
                </p>
              </div>
              <button 
                onClick={() => toggleRule(rule.id, !rule.isActive)}
                className={`btn ${rule.isActive ? 'btn-primary' : 'btn-secondary'}`}
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
