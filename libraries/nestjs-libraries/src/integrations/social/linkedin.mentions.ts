/**
 * Company tagging (@mentions) for LinkedIn channels.
 *
 * Why this exists: the only company lookup LinkedIn offers
 * (organizations?q=vanityName) needs the Community Management app. Profile
 * channels run on the self-serve app, and LinkedIn answers them with a 403 —
 * so the @ dropdown was always empty when posting as a person, which is the
 * case that matters most. The tag itself is just text in the post
 * (`@[Name](urn:li:organization:<id>)`), so a profile only needs the company's
 * id; a connected LinkedIn Page channel is allowed to fetch it.
 *
 * The lookup is also exact-handle only ("datafly-signal", not "Datafly Signal"),
 * so this adds:
 *  - our own connected pages, matched by name or handle with no API call;
 *  - handle guesses for a typed name, and handles pulled from a pasted URL;
 *  - one shared cache for every LinkedIn channel, so a company found once is
 *    then findable by name;
 *  - a short memory of handles already looked up, because the editor looks
 *    up as you type and the Community app is on a limited Development Tier.
 *
 * Handle guesses can land on the wrong company: "Treasure AI" → treasure-ai is
 * Treasure Financial, while treasureai is a different page. So every guess is
 * tried and every match is offered, rather than stopping at the first.
 */

export type LinkedinMention = { id: string; label: string; image: string };

export const LINKEDIN_PROVIDERS = ['linkedin', 'linkedin-page'];

/** One cache for profiles and pages — organization ids are the same for both. */
export const LINKEDIN_MENTION_CACHE = 'linkedin';

/** Skip the API for lookups too short to be a real handle. */
export const MIN_LOOKUP_LENGTH = 3;

type PageIntegration = {
  internalId: string;
  name: string;
  profile?: string | null;
  picture?: string | null;
};

/** Connected LinkedIn pages whose name or handle contains the query. */
export function matchConnectedPages(
  pages: PageIntegration[],
  rawQuery: string
): LinkedinMention[] {
  const q = normalise(rawQuery);
  if (!q) {
    return [];
  }
  return pages
    .filter(
      (p) =>
        normalise(p.name).includes(q) || normalise(p.profile || '').includes(q)
    )
    .map((p) => ({ id: String(p.internalId), label: p.name, image: p.picture || '' }));
}

/**
 * Handles worth trying for what was typed, most likely first: the handle in a
 * pasted company URL, else the query as a handle, else its hyphenated and
 * run-together forms ("Datafly Signal" → datafly-signal, dataflysignal).
 */
export function vanityCandidates(rawQuery: string): string[] {
  const query = rawQuery.trim().replace(/^@/, '');
  const fromUrl = query.match(/linkedin\.com\/company\/([^/?#\s]+)/i);
  if (fromUrl) {
    return [decodeURIComponent(fromUrl[1]).toLowerCase()];
  }

  const lower = query.toLowerCase();
  if (lower.length < MIN_LOOKUP_LENGTH) {
    return [];
  }
  const words = lower.split(/\s+/).filter(Boolean);
  const candidates =
    words.length > 1 ? [words.join('-'), words.join('')] : [lower];
  // Handles are letters, digits and hyphens; anything else can't match.
  return [...new Set(candidates)].filter((c) => /^[a-z0-9-]+$/.test(c));
}

const LOOKUP_TTL_MS = 30 * 60 * 1000;
const MAX_LOOKUPS = 500;
const lookedUp = new Map<string, number>();

/** Was this handle looked up recently? A hit is in the cache by then and a
 *  miss won't change, so either way there's no point asking LinkedIn again. */
export function recentlyLookedUp(vanity: string, now = Date.now()) {
  const until = lookedUp.get(vanity);
  if (until === undefined) {
    return false;
  }
  if (until <= now) {
    lookedUp.delete(vanity);
    return false;
  }
  return true;
}

export function rememberLookup(vanity: string, now = Date.now()) {
  if (lookedUp.size >= MAX_LOOKUPS) {
    // Oldest entry first — Map keeps insertion order.
    lookedUp.delete(lookedUp.keys().next().value as string);
  }
  lookedUp.set(vanity, now + LOOKUP_TTL_MS);
}

/** Letters and digits only, lowercased: "Treasure AI" and "Treasureai" agree. */
export function compactName(s: string) {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Cache searches worth running: as typed, and without spaces or hyphens so a
 *  multi-word query still finds a company whose name is written as one word. */
export function cacheQueries(rawQuery: string): string[] {
  const q = rawQuery.trim().replace(/^@/, '');
  return [...new Set([q, q.replace(/[\s-]+/g, '')])].filter(Boolean);
}

function normalise(s: string) {
  return (s || '').toLowerCase().replace(/^@/, '').replace(/[\s-]+/g, ' ').trim();
}
