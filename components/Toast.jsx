'use client';
import { createContext, useContext, useState, useCallback } from 'react';
import { CircleCheck, X, AlertTriangle, Info } from './Icons';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  /** Toasts stay until dismissed (×). Pass `duration` in ms only if you want auto-dismiss for that toast. */
  const addToast = useCallback(({ type = 'info', title, message, duration = null }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, title, message }]);
    if (duration != null && Number(duration) > 0) {
      const ms = Number(duration);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, ms);
    }
  }, []);

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ addToast, dismissToast: dismiss }}>
      {children}
      <div
        className="fixed top-4 right-4 z-[100] flex max-h-[calc(100vh-2rem)] flex-col gap-2 overflow-y-auto pointer-events-none pr-1"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast-in pointer-events-auto flex items-start gap-3 border border-cream/15 bg-ink text-cream px-4 py-3.5 rounded-xl shadow-pop max-w-sm"
          >
            <span className="mt-0.5 shrink-0">
              {toast.type === 'success' && <CircleCheck size={16} className="text-teal-bright" />}
              {toast.type === 'error' && <AlertTriangle size={16} className="text-rose-soft" />}
              {toast.type === 'info' && <Info size={16} className="text-cream/70" />}
            </span>
            <div className="flex-1 min-w-0">
              {toast.title && <div className="text-sm font-medium leading-snug">{toast.title}</div>}
              {toast.message && <div className="text-[12px] text-cream/70 mt-1 leading-relaxed">{toast.message}</div>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="text-cream/50 hover:text-cream shrink-0 rounded-md p-0.5 ring-focus"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
