'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { dismissToast } from '@/lib/studioBus';
import { useBus } from './hooks';

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info };

export default function Toasts() {
  const { toasts } = useBus();
  return (
    <div className="toastStack" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.type] || Info;
        return (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon size={16} aria-hidden="true" className="toastIcon" />
            <span className="toastText">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="toastAction"
                onClick={() => {
                  t.action.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="toastClose"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
