"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { Sun, Moon, Monitor, ShieldOff, Eye, EyeOff, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PrivacySettings } from "@/types";
import { useTheme, ThemeMode } from "@/hooks/useTheme";
import { api, ApiError } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { cn } from "@/lib/utils";
import { ChatLockSettings } from "@/components/settings/ChatLockSettings";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function SettingsPage() {
  const { logout } = useAuth();
  const { mode, setMode } = useTheme();

  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacySaved, setPrivacySaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ settings: PrivacySettings }>("/privacy")
      .then((res) => {
        if (!cancelled) setPrivacy(res.settings);
      })
      .catch((err) => {
        if (!cancelled) {
          setPrivacyError(err instanceof ApiError ? err.message : "Could not load privacy settings");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function savePrivacy(next: PrivacySettings) {
    setPrivacy(next);
    setPrivacySaving(true);
    setPrivacySaved(false);
    setPrivacyError(null);
    try {
      const res = await api.put<{ settings: PrivacySettings }>("/privacy", next);
      setPrivacy(res.settings);
      setPrivacySaved(true);
      window.setTimeout(() => setPrivacySaved(false), 1800);
    } catch (err) {
      setPrivacyError(err instanceof ApiError ? err.message : "Could not save privacy settings");
    } finally {
      setPrivacySaving(false);
    }
  }

  function updatePrivacy<K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) {
    if (!privacy) return;
    void savePrivacy({ ...privacy, [key]: value });
  }

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);

    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }

    setPwSaving(true);
    try {
      await api.put("/profile/password", { currentPassword, newPassword });
      setPwSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Could not change password");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm account deletion");
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.delete("/profile", { password: deletePassword });
      await logout();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-4 pb-10 sm:p-6">
      <h1 className="mb-1 text-lg font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-muted">Manage your account, appearance, and security.</p>

      {/* Appearance */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="mb-3 font-medium">Appearance</h2>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors",
                mode === value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:bg-surface-hover"
              )}
              aria-pressed={mode === value}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Privacy & Security */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-medium">Privacy & security</h2>
          <p className="mt-1 text-sm text-muted">
            Control what other people can see and what Sakhya shows in notifications.
          </p>
        </div>

        <ErrorBanner message={privacyError} />

        {!privacy ? (
          <div className="rounded-lg border border-border bg-background px-3 py-3 text-sm text-muted">
            Loading privacy controls…
          </div>
        ) : (
          <div className="divide-y divide-border">
            {[
              {
                key: "readReceipts" as const,
                title: "Read receipts",
                description: "Let friends know when you have seen their messages.",
              },
              {
                key: "typingIndicators" as const,
                title: "Typing indicators",
                description: "Show when you are typing in a conversation.",
              },
              {
                key: "onlineStatus" as const,
                title: "Online status",
                description: "Let friends see when you are currently online.",
              },
              {
                key: "messagePreview" as const,
                title: "Message previews",
                description: "Show message text in notifications. Turn this off for a more private lock screen.",
              },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{item.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={privacy[item.key]}
                  disabled={privacySaving}
                  onClick={() => updatePrivacy(item.key, !privacy[item.key])}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    privacy[item.key] ? "bg-accent" : "bg-border",
                    privacySaving && "cursor-wait opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                      privacy[item.key] ? "translate-x-5" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>
            ))}

            <div className="py-3.5">
              <div className="mb-2">
                <p className="text-sm font-medium">Last seen visibility</p>
                <p className="mt-0.5 text-xs leading-5 text-muted">
                  Choose who can see when you were last active.
                </p>
              </div>
              <select
                value={privacy.lastSeenVisibility}
                disabled={privacySaving}
                onChange={(e) =>
                  updatePrivacy(
                    "lastSeenVisibility",
                    e.target.value as PrivacySettings["lastSeenVisibility"]
                  )
                }
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="everyone">Everyone</option>
                <option value="friends">Friends</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 pt-3.5 text-xs">
              <span className="text-muted">
                {privacySaving ? "Saving privacy settings…" : privacySaved ? "Privacy settings saved." : "Privacy settings are synced to your account."}
              </span>
              <Link
                href="/friends?tab=blocked"
                className="shrink-0 rounded-lg px-2 py-1.5 text-accent hover:bg-accent-soft"
              >
                Blocked users
                <ChevronRight size={14} className="ml-1 inline" />
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* Chat Lock */}
      <ChatLockSettings />

      {/* Change password */}
      <form
        onSubmit={handlePasswordChange}
        className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6"
      >
        <h2 className="font-medium">Change password</h2>
        <ErrorBanner message={pwError} />
        {pwSuccess && (
          <div className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
            Password updated. Please sign in again on other devices.
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="currentPassword">
            Current password
          </label>
          <div className="relative">
            <Input
              id="currentPassword"
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              aria-label={showCurrent ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-hover"
            >
              {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="newPassword">
            New password
          </label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              aria-label={showNew ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-hover"
            >
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <Button type="submit" disabled={pwSaving} className="w-fit">
          {pwSaving ? "Updating..." : "Update password"}
        </Button>
      </form>

      {/* Logout */}
      <div className="mb-6 flex items-center justify-between rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div>
          <h2 className="font-medium">Log out</h2>
          <p className="text-sm text-muted">Sign out of Sakhya on this device.</p>
        </div>
        <Button variant="outline" onClick={() => logout()}>
          Log out
        </Button>
      </div>

      {/* Delete account */}
      <div className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft p-5 sm:p-6">
        <div>
          <h2 className="font-medium text-danger">Delete account</h2>
          <p className="text-sm text-muted">
            This permanently deletes your account, messages, friends, and call history. This cannot be undone.
          </p>
        </div>
        <ErrorBanner message={deleteError} />
        {!confirmDelete ? (
          <Button variant="danger" className="w-fit" onClick={() => setConfirmDelete(true)}>
            Delete my account
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              type="password"
              placeholder="Enter your password to confirm"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
            />
            <div className="flex items-center gap-3">
              <Button variant="danger" disabled={deleting} onClick={handleDeleteAccount}>
                {deleting ? "Deleting..." : "Yes, permanently delete"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeletePassword("");
                  setDeleteError(null);
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
