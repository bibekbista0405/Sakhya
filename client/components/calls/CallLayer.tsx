"use client";

import { useEffect, useState } from "react";
import { useCall } from "@/hooks/useCall";
import { IncomingCallModal } from "@/components/calls/IncomingCallModal";
import { ActiveCallScreen } from "@/components/calls/ActiveCallScreen";

export function CallLayer() {
  const { errorMessage, clearError } = useCall();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!errorMessage) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      clearError();
    }, 4000);
    return () => clearTimeout(t);
  }, [errorMessage, clearError]);

  return (
    <>
      <IncomingCallModal />
      <ActiveCallScreen />
      {errorMessage && visible && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-foreground px-4 py-2.5 text-sm text-white shadow-lg">
          {errorMessage}
        </div>
      )}
    </>
  );
}
