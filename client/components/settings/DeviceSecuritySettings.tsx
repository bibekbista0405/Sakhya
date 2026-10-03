"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Copy, KeyRound, Pencil, RefreshCw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getOwnDeviceId } from "@/lib/crypto";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastActiveAt: string;
  isPrimary: boolean;
  isCurrent: boolean;
  remainingOneTimeKeys: number;
  lowOnKeys: boolean;
}

interface Pairing {
  pairingId: string;
  secret: string;
  payload: string;
  expiresAt: string;
  status?: "pending" | "approved";
}

function relativeDate(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function parsePayload(value: string): { pairingId: string; secret: string } | null {
  const match = value.trim().match(/^sakhya-pair:v1:([^:]+):(.+)$/);
  return match ? { pairingId: match[1], secret: match[2] } : null;
}

export function DeviceSecuritySettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [pairingQr, setPairingQr] = useState<string | null>(null);
  const [pairingInput, setPairingInput] = useState("");
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyDevice, setBusyDevice] = useState<string | null>(null);

  async function loadDevices() {
    try {
      setError(null);
      const ownId = await getOwnDeviceId();
      const res = await api.get<{ devices: Device[] }>("/devices");
      setDevices(res.devices.map((d) => ({ ...d, isCurrent: d.id === ownId || d.isCurrent })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDevices(); }, []);

  async function renameDevice(device: Device) {
    const name = renameValue.trim();
    if (!name) return;
    setBusyDevice(device.id);
    try {
      await api.patch<{ success: boolean }>(`/devices/${device.id}`, { name });
      setRenaming(null);
      await loadDevices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename device");
    } finally { setBusyDevice(null); }
  }

  async function revokeDevice(device: Device) {
    if (device.isCurrent) return;
    if (!window.confirm(`Revoke ${device.name}? It will be signed out and cannot establish new encrypted sessions.`)) return;
    setBusyDevice(device.id);
    try {
      await api.delete(`/devices/${device.id}`);
      await loadDevices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke device");
    } finally { setBusyDevice(null); }
  }

  async function revokeOthers() {
    if (!window.confirm("Revoke every other Sakhya device and sign them out?")) return;
    setBusyDevice("all");
    try {
      await api.post("/devices/revoke-others");
      await loadDevices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke other devices");
    } finally { setBusyDevice(null); }
  }

  async function createPairing() {
    setPairingBusy(true); setPairingMessage(null);
    try {
      const res = await api.post<Pairing>("/devices/pairing/create", { targetDeviceName: "New Sakhya device" });
      setPairing(res);
      setPairingQr(await QRCode.toDataURL(res.payload, { width: 220, margin: 2 }));
    } catch (err) {
      setPairingMessage(err instanceof ApiError ? err.message : "Could not create pairing request");
    } finally { setPairingBusy(false); }
  }

  useEffect(() => {
    if (!pairing?.pairingId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.get<{ status: "pending" | "approved" }>(`/devices/pairing/${pairing.pairingId}`);
        setPairing((current) => current ? { ...current, status: res.status } : current);
        if (res.status === "approved") setPairingMessage("This device has been approved. Its own E2EE identity remains separate from your other devices.");
      } catch { /* expiry is surfaced by the next user action */ }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pairing?.pairingId]);

  async function approvePairing() {
    const parsed = parsePayload(pairingInput);
    if (!parsed) { setPairingMessage("Invalid Sakhya pairing QR/code."); return; }
    setPairingBusy(true); setPairingMessage(null);
    try {
      await api.post("/devices/pairing/approve", parsed);
      setPairingInput("");
      setPairingMessage("New device approved. It will keep its own private E2EE identity.");
    } catch (err) {
      setPairingMessage(err instanceof ApiError ? err.message : "Could not approve pairing");
    } finally { setPairingBusy(false); }
  }

  async function copyPayload() {
    if (!pairing?.payload) return;
    await navigator.clipboard.writeText(pairing.payload);
    setPairingMessage("Pairing code copied.");
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex gap-2">
          <ShieldCheck size={17} className="mt-0.5 text-muted" />
          <div>
            <h2 className="font-medium">Your devices</h2>
            <p className="mt-1 text-sm leading-5 text-muted">Manage encrypted identities and sign out devices you no longer trust. Private E2EE keys stay on each device.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => void loadDevices()} disabled={loading}><RefreshCw size={14} /></Button>
      </div>

      <ErrorBanner message={error} />
      {loading ? <p className="py-3 text-sm text-muted">Loading devices…</p> : (
        <div className="space-y-2">
          {devices.map((device) => (
            <div key={device.id} className="rounded-lg border border-border bg-background p-3">
              {renaming === device.id ? (
                <div className="flex gap-2">
                  <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value.slice(0, 60))} autoFocus />
                  <Button disabled={!renameValue.trim() || busyDevice === device.id} onClick={() => void renameDevice(device)}>Save</Button>
                  <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Smartphone size={18} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{device.name}</p>
                      {device.isCurrent && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">This device</span>}
                      {device.isPrimary && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">Primary</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">Last active {relativeDate(device.lastActiveAt)} · {device.remainingOneTimeKeys} encryption prekeys</p>
                  </div>
                  <button className="rounded-md p-2 text-muted hover:bg-surface-hover" title="Rename" onClick={() => { setRenaming(device.id); setRenameValue(device.name); }}><Pencil size={14} /></button>
                  {!device.isCurrent && <button disabled={busyDevice === device.id} className="rounded-md p-2 text-danger hover:bg-danger-soft disabled:opacity-50" title="Revoke" onClick={() => void revokeDevice(device)}><Trash2 size={14} /></button>}
                </div>
              )}
            </div>
          ))}
          {devices.length > 1 && <Button variant="danger" className="mt-2" disabled={busyDevice === "all"} onClick={() => void revokeOthers()}>Revoke all other devices</Button>}
        </div>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <div className="mb-3 flex items-center gap-2"><KeyRound size={16} className="text-muted" /><h3 className="font-medium">Secure device pairing</h3></div>
        <p className="mb-3 text-xs leading-5 text-muted">A pairing approval proves that a new device was physically approved by an existing signed-in device. Each device still generates its own Olm identity; Sakhya never copies private E2EE keys through the server.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-medium">Pair this device</p>
            <p className="mb-3 text-xs text-muted">Generate a short-lived QR/code and approve it from another trusted Sakhya device.</p>
            <Button onClick={() => void createPairing()} disabled={pairingBusy}>{pairingBusy ? "Creating…" : "Generate pairing QR"}</Button>
            {pairingQr && pairing && <div className="mt-3 flex flex-col items-center gap-2"><img src={pairingQr} alt="Sakhya device pairing QR code" className="h-44 w-44 rounded-lg bg-white p-2" /><button onClick={() => void copyPayload()} className="flex items-center gap-1 text-xs text-accent"><Copy size={12} /> Copy pairing code</button><span className="text-[11px] text-muted">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</span><span className="text-xs">{pairing.status === "approved" ? <span className="text-success">Approved ✓</span> : "Waiting for approval…"}</span></div>}
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-medium">Approve a new device</p>
            <p className="mb-3 text-xs text-muted">On the new device, copy its Sakhya pairing code or QR payload here. Verify the device physically before approving.</p>
            <Input value={pairingInput} onChange={(e) => setPairingInput(e.target.value)} placeholder="sakhya-pair:v1:…" />
            <Button className="mt-2" onClick={() => void approvePairing()} disabled={pairingBusy || !pairingInput.trim()}><CheckCircle2 size={14} className="mr-1" /> Approve device</Button>
          </div>
        </div>
        {pairingMessage && <p className="mt-3 text-xs text-muted">{pairingMessage}</p>}
      </div>
    </section>
  );
}
