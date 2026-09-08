"use client";

import { useState, FormEvent } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError } from "@/lib/api";

interface Props {
  title?: string;
  description?: string;
  onSubmit: (pin: string) => Promise<boolean | void>;
  onCancel?: () => void;
  fullScreen?: boolean;
}

/**
 * A PIN-entry prompt used both to view locked chats (via ChatLockContext.verify)
 * and to unlock/remove a specific conversation's lock (which calls a
 * different endpoint but needs the same "ask for the PIN" UI).
 */
export function ChatLockPrompt({ title = "Enter your PIN", description, onSubmit, onCancel, fullScreen }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit(pin);
      if (result === false) {
        setError("Incorrect PIN");
        setPin("");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Too many incorrect attempts. Please wait before trying again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-6 text-center shadow-xl">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Lock size={22} />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <Input
          type="password"
          inputMode="numeric"
          pattern="\d*"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="PIN"
          className="text-center text-lg tracking-widest"
          aria-label="PIN"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting || pin.length < 4}>
          {submitting ? "Checking..." : "Unlock"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </form>
      <p className="text-xs text-muted">
        No software can guarantee this protects against someone who already has your device unlocked and
        under their control.
      </p>
    </div>
  );

  if (!fullScreen) return content;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">{content}</div>
  );
}
