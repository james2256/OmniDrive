import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Clipboard copy with fallback for non-secure (HTTP) contexts.
 * Fixes Bug 8: SharedLinksPage crashed on HTTP because navigator.clipboard
 * is undefined. Also fixes M-18: setTimeout not cleaned up on unmount.
 *
 * Per-ID tracking: copiedId holds the id passed to copy(), or null after
 * timeout. This lets list views show "Copied!" only on the clicked card
 * (fixes SL1 — previously all cards flipped because `copied` was a boolean).
 */
export function useClipboard(timeout = 2000) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string, id?: string) => {
      setError('');
      try {
        if (!navigator.clipboard) {
          // Non-secure context (HTTP) — fall back to execCommand
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        } else {
          await navigator.clipboard.writeText(text);
        }
        setCopiedId(id ?? null);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopiedId(null), timeout);
      } catch {
        setError('Failed to copy to clipboard');
      }
    },
    [timeout],
  );

  return { copiedId, error, copy };
}
