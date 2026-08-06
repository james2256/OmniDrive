import { CheckCircle2, XCircle, ScrollText } from 'lucide-react';
import { useAutomationLogs } from '../../hooks/useAutomations';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/Button';
import { formatAbsoluteDate } from '../../lib/utils';

interface AutomationLogsModalProps {
  ruleId: string | null;
  ruleName: string | null;
  onClose: () => void;
}

/**
 * Display execution logs for a single automation rule. The query is disabled
 * when ruleId is null (modal closed) so no fetch fires.
 */
export function AutomationLogsModal({ ruleId, ruleName, onClose }: AutomationLogsModalProps) {
  const { logs, isLoading, error } = useAutomationLogs(ruleId);
  const open = !!ruleId;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<ScrollText size={20} className="text-primary" />}>
          <DialogTitle>Execution Logs{ruleName ? `: ${ruleName}` : ''}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading logs...</div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-red-600">Failed to load logs.</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No execution logs yet. Logs appear here after the rule processes a file.
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {logs.map((log) => {
                const isSuccess = log.status === 'success';
                return (
                  <li key={log.id} className="py-2.5 flex items-start gap-2.5">
                    {isSuccess ? (
                      <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800 capitalize">
                          {log.status}
                        </span>
                        <span className="text-[11px] text-slate-500 flex-shrink-0">
                          {formatAbsoluteDate(log.executedAt)}
                        </span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-slate-500 mt-0.5 break-words">{log.details}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
