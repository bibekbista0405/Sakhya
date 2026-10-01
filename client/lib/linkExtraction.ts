/**
 * Extracts URLs from already-decrypted message text, for Chat Info's Links
 * tab. This is necessarily client-side-only and limited to whatever
 * conversation history is currently loaded in memory — there is no
 * server-side equivalent to "fetch all links ever shared," because a URL
 * inside message text is invisible to the server for an encrypted
 * conversation (same reason the media gallery feed can only say "this
 * message has an attachment," never what kind — see routes/messages.ts's
 * /media endpoint). Don't present this as a complete archive; it only
 * reflects what's been decrypted on this device in this session.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export interface ExtractedLink {
  url: string;
  messageId: string;
  createdAt: string;
}

export function extractLinks(messages: { id: string; content: string; createdAt: string; deletedAt?: string | null }[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const m of messages) {
    if (m.deletedAt) continue;
    const matches = m.content.match(URL_PATTERN);
    if (!matches) continue;
    for (const url of matches) {
      const cleaned = url.replace(/[.,;:!?]+$/, "");
      links.push({ url: cleaned, messageId: m.id, createdAt: m.createdAt });
    }
  }
  return links.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
