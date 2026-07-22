import { useEffect, useState } from 'react';
import type { AuditLog } from '../../types';
import { api } from '../../lib/api';

export function WorkspaceAuditTab({ workspaceId }: { workspaceId: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    api.getWorkspaceAuditLogs(workspaceId).then((res) => setLogs(res.logs)).catch(console.error);
  }, [workspaceId]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Audit Logs</h2>
      <table className="w-full text-left bg-card rounded-lg shadow overflow-hidden">
        <thead className="bg-slate-50 border-b">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Actor</th>
            <th className="px-4 py-2">Action</th>
            <th className="px-4 py-2">Resource</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b last:border-0 hover:bg-slate-50">
              <td className="px-3 py-1.5 text-sm text-slate-500">{new Date(log.createdAt || (log as AuditLog & { created_at?: string; actor_email?: string; action_type?: string; resource_name?: string; resource_id?: string }).created_at || '').toLocaleString()}</td>
              <td className="px-3 py-1.5 text-sm">{(log as AuditLog & { created_at?: string; actor_email?: string; action_type?: string; resource_name?: string; resource_id?: string }).actor_email || log.actorId}</td>
              <td className="px-4 py-2 font-mono text-xs text-blue-600 bg-blue-50 w-max rounded px-2 py-1 inline-block mt-2 ml-4">{log.actionType || (log as AuditLog & { created_at?: string; actor_email?: string; action_type?: string; resource_name?: string; resource_id?: string }).action_type}</td>
              <td className="px-3 py-1.5 text-sm">{log.resourceName || (log as AuditLog & { created_at?: string; actor_email?: string; action_type?: string; resource_name?: string; resource_id?: string }).resource_name || log.resourceId || (log as AuditLog & { created_at?: string; actor_email?: string; action_type?: string; resource_name?: string; resource_id?: string }).resource_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
