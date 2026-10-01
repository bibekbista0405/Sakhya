"use client";

/**
 * OS-level notifications shown via the Web Notifications API. These are
 * distinct from the in-app notification list (hooks/useNotifications.tsx):
 * this only fires while the tab is open somewhere (foreground or background)
 * — there is no push-service/service-worker setup here, so nothing arrives
 * if the browser itself is fully closed. Don't describe this to users as
 * "notifications even when the app is closed" — it isn't that.
 */

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isBrowserNotificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isBrowserNotificationSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Only show a browser notification when the user isn't already looking at
 * the tab — popping up a system notification for something already visible
 * on screen is just noise (and, for multi-tab/multi-device use, each open
 * tab independently applies this same check rather than trying to coordinate
 * across tabs/devices, which would need shared server-side state we don't have).
 */
function shouldShowBrowserNotification(): boolean {
  return isBrowserNotificationSupported() && Notification.permission === "granted" && document.hidden;
}

// Tracked so logout can proactively close anything still on-screen — see
// closeAllBrowserNotifications() below.
const activeNotifications = new Set<Notification>();

export function showBrowserNotification(
  title: string,
  options: NotificationOptions & { onClick?: () => void } = {}
): void {
  if (!shouldShowBrowserNotification()) return;
  const { onClick, ...notifOptions } = options;
  try {
    const notif = new Notification(title, { icon: "/favicon.ico", ...notifOptions });
    activeNotifications.add(notif);
    const cleanup = () => activeNotifications.delete(notif);
    notif.onclick = () => {
      window.focus();
      onClick?.();
      notif.close();
    };
    notif.onclose = cleanup;
    // Auto-close after a while so these don't pile up in the OS notification
    // center indefinitely — the in-app notification list is the durable record.
    setTimeout(() => notif.close(), 15_000);
  } catch {
    // Notification construction can throw in some embedded/webview contexts;
    // never let a notification failure break the app.
  }
}

/** Closes any notifications this tab currently has on-screen. Call on logout. */
export function closeAllBrowserNotifications(): void {
  for (const notif of activeNotifications) notif.close();
  activeNotifications.clear();
}
