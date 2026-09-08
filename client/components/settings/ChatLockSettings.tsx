"use client";

import { useState, FormEvent } from "react";
import { Lock } from "lucide-react";
import { useChatLock } from "@/hooks/useChatLock";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { ApiError } from "@/lib/api";

function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function ChatLockSettings() {
  const chatLock = useChatLock();
  const [mode, setMode] = useState<"idle" | "set" | "change" | "remove">("idle");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setMode("idle");
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setError(null);
  }

  async function handleSetOrChange(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidPin(newPin)) {
      setError("PIN must be 4-8 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    setSaving(true);
    try {
      await chatLock.setPin(newPin, chatLock.hasPin ? currentPin : undefined);
      setSuccess(chatLock.hasPin ? "PIN updated." : "Chat Lock PIN set.");
      window.setTimeout(() => setSuccess(null), 2500);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save PIN");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await chatLock.removePin(currentPin);
      setSuccess("Chat Lock PIN removed. All locked chats have been unlocked.");
      window.setTimeout(() => setSuccess(null), 3000);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove PIN");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Lock size={16} className="text-muted" />
        <div>
          <h2 className="font-medium">Chat Lock</h2>
          <p className="mt-1 text-sm text-muted">
            Set a PIN to hide specific conversations behind a lock. Lock or unlock a chat from its options
            menu. This protects against someone briefly picking up an unlocked device — it can&apos;t protect
            against someone who has full control of your device or account.
          </p>
        </div>
      </div>

      {success && (
        <div className="mb-3 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
          {success}
        </div>
      )}

      {mode === "idle" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {chatLock.hasPin
              ? `Chat Lock is on${chatLock.lockedFriendIds.length > 0 ? ` (${chatLock.lockedFriendIds.length} locked)` : ""}.`
              : "Chat Lock is off."}
          </p>
          <div className="flex gap-2">
            {chatLock.hasPin ? (
              <>
                <Button variant="outline" onClick={() => setMode("change")}>
                  Change PIN
                </Button>
                <Button variant="danger" onClick={() => setMode("remove")}>
                  Turn off
                </Button>
              </>
            ) : (
              <Button onClick={() => setMode("set")}>Set PIN</Button>
            )}
          </div>
        </div>
      )}

      {(mode === "set" || mode === "change") && (
        <form onSubmit={handleSetOrChange} className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {chatLock.hasPin && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="currentPin">
                Current PIN
              </label>
              <Input
                id="currentPin"
                type="password"
                inputMode="numeric"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                autoComplete="off"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="newPin">
              New PIN (4-8 digits)
            </label>
            <Input
              id="newPin"
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="confirmPin">
              Confirm new PIN
            </label>
            <Input
              id="confirmPin"
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "remove" && (
        <form onSubmit={handleRemove} className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          <p className="text-sm text-muted">Enter your current PIN to turn off Chat Lock. This unlocks every locked conversation.</p>
          <Input
            type="password"
            inputMode="numeric"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Current PIN"
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={saving || currentPin.length < 4}>
              {saving ? "Removing..." : "Turn off Chat Lock"}
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
