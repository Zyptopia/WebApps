// Lightweight, client-only chat moderation & throttling for RoomClient.
// - Enforces max length
// - Duplicate filter (15s window)
// - Excessive caps filter (>70% A–Z and length >= 12)
// - URL scrub (removes http/https links)
// - Profanity mask (b•• style) with minimal, extensible dictionary
// - Slow mode per room (options.slowModeMs) with cooldown reporting
// - Normalizes whitespace and trims

export type ModerationReason = 'TOO_LONG' | 'EMPTY' | 'DUPLICATE' | 'CAPS' | 'COOLDOWN' | 'OK';

export interface ModerateInput {
  roomId: string;
  playerId: string;
  text: string;
  options?: { allowLinks?: boolean; slowModeMs?: number };
}

export interface ModerateResult {
  ok: boolean;
  reason: ModerationReason;
  text?: string; // cleaned text when ok
  cooldownMsLeft?: number; // when blocked by slow mode
  replaced?: boolean; // if any masking/scrubbing occurred
  original?: string; // original text when replaced
}

const DUPLICATE_WINDOW_MS = 15_000; // 15s
const LINK_RE = /https?:\/\/\S+/gi;

const DEFAULT_BAD_WORDS: string[] = [
  // Tiny starter list; you can extend at runtime via extendBadWords([...])
  'bad',
  'worse',
  'awful',
];

function collapseWhitespace(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

function maskWord(word: string): string {
  if (word.length <= 2) return '•'.repeat(word.length);
  const first = word[0];
  const last = word[word.length - 1];
  return first + '•'.repeat(word.length - 2) + last;
}

function buildBadWordRegex(words: string[]): RegExp | null {
  if (!words.length) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pat = `\\b(${escaped.join('|')})\\b`;
  return new RegExp(pat, 'gi');
}

export class ModerationEngine {
  private chatMaxLen: number;
  private badWords: Set<string>;
  private badWordRe: RegExp | null;
  private lastSentAt = new Map<string, number>(); // key: playerId
  private lastText = new Map<string, { textNorm: string; at: number }>();

  constructor(opts: { chatMaxLen: number; badWords?: string[] }) {
    this.chatMaxLen = opts.chatMaxLen;
    const list = (opts.badWords && opts.badWords.length ? opts.badWords : DEFAULT_BAD_WORDS).map(
      (w) => w.toLowerCase()
    );
    this.badWords = new Set(list);
    this.badWordRe = buildBadWordRegex([...this.badWords]);
  }

  extendBadWords(words: string[]) {
    for (const w of words) this.badWords.add(w.toLowerCase());
    this.badWordRe = buildBadWordRegex([...this.badWords]);
  }

  async moderate(input: ModerateInput): Promise<ModerateResult> {
    const now = Date.now();
    const { playerId } = input;
    let text = collapseWhitespace(input.text);

    if (!text) return { ok: false, reason: 'EMPTY' };
    if (text.length > this.chatMaxLen) return { ok: false, reason: 'TOO_LONG' };

    // Duplicate detection (normalized, case-insensitive)
    const norm = text.toLowerCase();
    const last = this.lastText.get(playerId);
    if (last && last.textNorm === norm && now - last.at < DUPLICATE_WINDOW_MS) {
      return { ok: false, reason: 'DUPLICATE' };
    }

    // Excessive caps: measure ratio for alphabetic chars only
    const lettersOnly = text.replace(/[^a-z]/gi, '');
    if (lettersOnly.length >= 12) {
      const upper = (lettersOnly.match(/[A-Z]/g) || []).length;
      const ratio = lettersOnly.length ? upper / lettersOnly.length : 0;
      if (ratio > 0.7) return { ok: false, reason: 'CAPS' };
    }

    // Slow mode check
    const slow = Math.max(0, input.options?.slowModeMs || 0);
    if (slow > 0) {
      const lastAt = this.lastSentAt.get(playerId) || 0;
      const left = slow - (now - lastAt);
      if (left > 0) return { ok: false, reason: 'COOLDOWN', cooldownMsLeft: left };
    }

    let replaced = false;
    const original = text;

    // URL scrub (strip links when allowLinks !== true)
    if (!input.options?.allowLinks) {
      const newText = text
        .replace(LINK_RE, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (newText !== text) {
        text = newText;
        replaced = true;
      }
      if (!text) return { ok: false, reason: 'EMPTY' };
    }

    // Profanity mask
    if (this.badWordRe) {
      const before = text;
      text = text.replace(this.badWordRe, (m) => maskWord(m));
      if (text !== before) replaced = true;
    }

    // Cache state on success
    this.lastText.set(playerId, { textNorm: norm, at: now });
    if (slow > 0) this.lastSentAt.set(playerId, now);

    return { ok: true, reason: 'OK', text, replaced, original };
  }
}
