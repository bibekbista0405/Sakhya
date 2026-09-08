"use client";

import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { ShieldCheck, ShieldAlert, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { getOwnIdentityKeys } from "@/lib/crypto";
import {
  checkIdentity,
  acceptChangedIdentity,
  computeSecurityCode,
  getPinnedIdentity,
  markVerified,
  markUnverified,
} from "@/lib/trust";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { User } from "@/types";

interface Props {
  friend: User;
  onClose: () => void;
  /** If the panel was opened because a send was blocked on a changed key, offer to accept + resend. */
  blockedOnChange?: boolean;
  onAcceptAndRetry?: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "no-identity" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      groups: string[];
      verified: boolean;
      changed: boolean;
      qrDataUrl: string;
    };

export function SecurityVerification({ friend, onClose, blockedOnChange, onAcceptAndRetry }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!user) return;
    setState({ status: "loading" });
    try {
      const [own, identityRes] = await Promise.all([
        getOwnIdentityKeys(),
        api.get<{ devices: { id: string; curveIdentityKey: string; ed25519IdentityKey: string }[] }>(
          `/devices/identity/${friend.id}`
        ),
      ]);
      const peerDevice = identityRes.devices[0];
      if (!peerDevice) {
        setState({ status: "no-identity" });
        return;
      }

      // Non-destructive check: pins on first use, flags (without silently
      // overwriting) if it differs from what's already pinned.
      const trust = await checkIdentity(friend.id, {
        deviceId: peerDevice.id,
        curveIdentityKey: peerDevice.curveIdentityKey,
        ed25519IdentityKey: peerDevice.ed25519IdentityKey,
      });
      const pinned = await getPinnedIdentity(friend.id);

      const { groups, raw } = await computeSecurityCode(user.id, own.ed25519, friend.id, peerDevice.ed25519IdentityKey);
      const qrDataUrl = await QRCode.toDataURL(raw, { margin: 1, width: 220 });

      setState({
        status: "ready",
        groups,
        verified: trust.changed ? false : !!pinned?.verified,
        changed: trust.changed,
        qrDataUrl,
      });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Could not load security code" });
    }
  }, [friend.id, user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async () => {
    if (state.status !== "ready") return;
    const identityRes = await api.get<{ devices: { id: string; curveIdentityKey: string; ed25519IdentityKey: string }[] }>(
      `/devices/identity/${friend.id}`
    );
    const peerDevice = identityRes.devices[0];
    if (!peerDevice) return;
    await acceptChangedIdentity(friend.id, {
      deviceId: peerDevice.id,
      curveIdentityKey: peerDevice.curveIdentityKey,
      ed25519IdentityKey: peerDevice.ed25519IdentityKey,
    });
    await load();
    if (onAcceptAndRetry) onAcceptAndRetry();
  };

  const toggleVerified = async () => {
    if (state.status !== "ready") return;
    if (state.verified) await markUnverified(friend.id);
    else await markVerified(friend.id);
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Security verification">
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Security verification</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {state.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> Loading security code…
          </div>
        )}

        {state.status === "no-identity" && (
          <p className="py-6 text-sm text-muted">
            {friend.firstName || friend.username} hasn&apos;t set up encryption on any device yet, so there&apos;s no
            security code to compare.
          </p>
        )}

        {state.status === "error" && <p className="py-6 text-sm text-danger">{state.message}</p>}

        {state.status === "ready" && (
          <div className="flex flex-col gap-4">
            {(state.changed || blockedOnChange) && (
              <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                <ShieldAlert size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Security code changed</p>
                  <p className="mt-0.5 text-danger/90">
                    {friend.firstName || friend.username}&apos;s encryption key is different from the one you saw
                    before. This can happen after they reinstall the app or set up a new device — or it could mean
                    someone is trying to intercept your messages. Compare the code below with them before continuing.
                  </p>
                </div>
              </div>
            )}

            <p className="text-sm text-muted">
              Compare this code with {friend.firstName || friend.username} in person, on a call, or via a QR scan.
              If it matches on both ends, your conversation is verified as free of interception.
            </p>

            <div className="flex justify-center rounded-xl border border-border bg-background p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.qrDataUrl} alt="Security code QR" width={180} height={180} />
            </div>

            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-xl border border-border bg-background p-3 font-mono text-[13px] tabular-nums">
              {state.groups.map((g, i) => (
                <span key={i} className="text-center text-foreground">
                  {g}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 text-sm">
              {state.verified ? (
                <span className="flex items-center gap-1.5 text-success">
                  <ShieldCheck size={16} /> Verified
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted">
                  <ShieldAlert size={16} /> Not verified
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {(state.changed || blockedOnChange) && (
                <Button variant="danger" className="flex-1" onClick={handleAccept}>
                  Accept new code{onAcceptAndRetry ? " and send" : ""}
                </Button>
              )}
              {!state.changed && (
                <Button variant="outline" className="flex-1" onClick={toggleVerified}>
                  {state.verified ? "Mark as unverified" : "Mark as verified"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
