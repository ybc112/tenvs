import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ToastItem {
  id: number;
  type: "ok" | "err" | "info";
  msg: string;
}
type PushFn = (msg: string, type?: ToastItem["type"]) => void;

const ToastContext = createContext<PushFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback<PushFn>((msg, type = "info") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-3), { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4600);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-ico">{t.type === "ok" ? "✓" : t.type === "err" ? "!" : "†"}</span>
            <div>{t.msg}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);