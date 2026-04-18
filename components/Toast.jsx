'use client';
import { createContext, useContext, useState, useCallback } from 'react';
import { CircleCheck, X, AlertTriangle, Info } from './Icons';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(({ type = 'info', title, message, duration = 4000 }) => {
    const id = Date.now();
    setToasts(t => [...t, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, duration);
  }, []);

  const dismiss = (id) => setToasts(t => t.filter(x => x.id !== id));

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className="toast-in pointer-events-auto flex items-start gap-3 bg-ink text-cream px-4 py-3 rounded-xl shadow-pop max-w-sm">
            <span className="mt-0.5 shrink-0">
              {toast.type === 'success' && <CircleCheck size={16} className="text-teal-bright" />}
              {toast.type === 'error' && <AlertTriangle size={16} className="text-rose-soft" />}
              {toast.type === 'info' && <Info size={16} className="text-cream/70" />}
            </span>
            <div className="flex-1 min-w-0">
              {toast.title && <div className="text-sm font-medium">{toast.title}</div>}
              {toast.message && <div className="text-[12px] text-cream/70 mt-0.5">{toast.message}</div>}
            </div>
            <button onClick={() => dismiss(toast.id)} className="text-cream/50 hover:text-cream shrink-0">
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
