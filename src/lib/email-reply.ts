/** Pure helpers for inbound email replies (shared by server and tests). */

/** "Jane Doe <jane@x.com>" -> "jane@x.com" (lowercased). */
export function addressOf(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** Finds the thread token in any recipient, e.g. reply+3f9a…@reply.example.com */
export function replyTokenFrom(recipients: string): string | null {
  const m = recipients.match(/reply\+([a-f0-9]{24})@/i);
  return m ? m[1].toLowerCase() : null;
}

/** Keep only the new text of a reply: drop quoted history and common signatures. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s/i.test(line.trim()) && out.length) break;
    if (/^Sent from my (iPhone|iPad|Android|phone)/i.test(line.trim())) break;
    if (/^>/.test(line)) continue;
    if (line.trim() === "--") break;
    out.push(line);
  }
  return out.join("\n").trim();
}
