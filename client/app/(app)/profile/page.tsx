"use client";

import { useState, FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { User } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

function formatJoined(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      const res = await api.put<{ user: User }>("/profile", {
        username,
        bio,
        avatar,
        firstName,
        lastName,
      });
      updateUser(res.user);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-4 pb-10 sm:p-6">
      <h1 className="mb-1 text-lg font-semibold">Your profile</h1>
      <p className="mb-6 text-sm text-muted">This is what friends see about you.</p>

      <div className="mb-6 flex items-center gap-4 rounded-xl border border-border bg-surface p-5">
        <Avatar src={avatar || user.avatar} name={username || user.username} size={64} />
        <div className="min-w-0">
          <p className="truncate font-medium">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate text-sm text-muted">@{user.username}</p>
          <p className="mt-0.5 text-xs text-muted">Joined {formatJoined(user.createdAt)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <ErrorBanner message={error} />
        {success && (
          <div className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
            Profile updated.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="firstName">
              First name
            </label>
            <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="lastName">
              Last name
            </label>
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="username">
            Username
          </label>
          <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <Input id="email" value={user.email} disabled className="opacity-60" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="avatar">
            Avatar URL
          </label>
          <Input
            id="avatar"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="bio">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={300}
            rows={3}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Tell friends a little about yourself"
          />
        </div>

        <Button type="submit" disabled={saving} className="w-fit">
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </form>
    </div>
  );
}
