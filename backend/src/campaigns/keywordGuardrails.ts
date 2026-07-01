const BROAD_KEYWORD_CONTEXT: Record<string, string[]> = {
  data: ['mobile', 'bundle', 'internet', 'network', 'subscription', 'plan', 'gb', 'mb', 'airtime', 'balance', 'not working', 'finished', 'expired'],
  bank: ['transfer', 'transaction', 'payment', 'account', 'failed', 'reversed', 'declined', 'money', 'debit', 'credit'],
  money: ['transfer', 'transaction', 'payment', 'received', 'missing', 'reversed', 'declined', 'debit', 'credit', 'refund'],
  transfer: ['bank', 'failed', 'reversed', 'pending', 'money', 'transaction', 'account', 'payment', 'received'],
  support: ['help', 'issue', 'problem', 'failed', 'not working', 'complaint', 'customer'],
  problem: ['bank', 'transfer', 'payment', 'data', 'internet', 'account', 'transaction', 'network'],
  issue: ['bank', 'transfer', 'payment', 'data', 'internet', 'account', 'transaction', 'network'],
};

const DEFAULT_EXCLUDE_TERMS = [
  'analytics',
  'big data',
  'data analyst',
  'data analytics',
  'data privacy',
  'data science',
  'database',
  'dataset',
  'metadata',
  'privacy policy',
];

export type KeywordMatchDecision = {
  ok: boolean;
  matchedKeyword?: string;
  reason?: string;
};

export type XLocationFilter = {
  country?: string | null;
  place?: string | null;
  places?: string[] | null;
};

export type ValidatedXLocationFilter = {
  country?: string;
  places?: string[];
};

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCampaignKeyword(value: string): string {
  return value
    .trim()
    .replace(/^#/, '')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function isPhrase(keyword: string): boolean {
  return /\s/.test(unquote(keyword));
}

function isBroadSingleKeyword(keyword: string): boolean {
  return Boolean(BROAD_KEYWORD_CONTEXT[unquote(keyword).toLowerCase()]);
}

export function isStandaloneBroadKeyword(keyword: string): boolean {
  return isBroadSingleKeyword(keyword) && !isPhrase(keyword);
}

function containsTerm(text: string, term: string): boolean {
  const normalized = normalizeForMatch(term);
  if (!normalized) return false;
  if (/\s/.test(normalized)) return text.includes(normalized);
  return new RegExp(`(^|[^a-z0-9_])${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i').test(text);
}

export function validateXLocationFilter(location: XLocationFilter):
  | { ok: true; location: ValidatedXLocationFilter }
  | { ok: false; message: string } {
  const country = location.country?.trim().toUpperCase() ?? '';
  const rawPlaces = Array.isArray(location.places)
    ? location.places
    : location.place
      ? [location.place]
      : [];
  const places = Array.from(new Set(rawPlaces.map(place => place.trim().replace(/\s+/g, ' ')).filter(Boolean)));
  if (country && !/^[A-Z]{2}$/.test(country)) {
    return { ok: false, message: 'Country must be a two-letter ISO country code, for example NG.' };
  }
  if (places.length > 10) {
    return { ok: false, message: 'Select no more than 10 cities or places.' };
  }
  if (places.some(place => place.length > 80)) {
    return { ok: false, message: 'City or place must be 80 characters or fewer.' };
  }
  return {
    ok: true,
    location: {
      ...(country ? { country } : {}),
      ...(places.length ? { places } : {}),
    },
  };
}

export function buildXRecentSearchKeywordQuery(keyword: string, location: XLocationFilter = {}): string {
  const clean = normalizeCampaignKeyword(keyword);
  const phrase = unquote(clean);
  const searchTerm = isPhrase(clean) ? `"${phrase.replace(/"/g, '\\"')}"` : phrase;
  const validated = validateXLocationFilter(location);
  const filters = validated.ok
    ? [
        validated.location.country ? `place_country:${validated.location.country}` : '',
        validated.location.places?.length === 1
          ? `place:"${validated.location.places[0]!.replace(/["\\]/g, '\\$&')}"`
          : validated.location.places?.length
            ? `(${validated.location.places.map(place => `place:"${place.replace(/["\\]/g, '\\$&')}"`).join(' OR ')})`
            : '',
      ].filter(Boolean)
    : [];
  return [searchTerm, ...filters, '-is:retweet'].join(' ');
}

export function validateKeywordGuardrails(keywords: string[]): { ok: boolean; message?: string; normalized: string[] } {
  const normalized = Array.from(new Set(keywords.map(normalizeCampaignKeyword).filter(Boolean)));
  if (!normalized.length) return { ok: false, message: 'Provide at least one keyword.', normalized };

  const broadStandalone = normalized.find(isStandaloneBroadKeyword);
  if (broadStandalone) {
    return {
      ok: false,
      normalized,
      message: `Keyword "${broadStandalone}" is too broad as a standalone keyword. Replace it with exact phrases like "mobile data", "data not working", or "data bundle" so the campaign does not capture unrelated posts.`,
    };
  }

  return { ok: true, normalized };
}

export function evaluateStrictKeywordMatch(text: string, keywords: string[]): KeywordMatchDecision {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) return { ok: false, reason: 'empty_text' };

  const excluded = DEFAULT_EXCLUDE_TERMS.find(term => containsTerm(normalizedText, term));
  if (excluded) return { ok: false, reason: `excluded_term:${excluded}` };

  const normalizedKeywords = keywords.map(normalizeCampaignKeyword).filter(Boolean);
  if (!normalizedKeywords.length) return { ok: true };

  for (const keyword of normalizedKeywords) {
    const clean = unquote(keyword);
    const normalizedKeyword = normalizeForMatch(clean);
    if (!normalizedKeyword) continue;
    if (!containsTerm(normalizedText, normalizedKeyword)) continue;

    const broadContext = BROAD_KEYWORD_CONTEXT[normalizedKeyword];
    if (broadContext?.length) {
      const hasContext = broadContext.some(term => containsTerm(normalizedText, term));
      if (!hasContext) return { ok: false, matchedKeyword: keyword, reason: `broad_keyword_without_context:${keyword}` };
    }

    return { ok: true, matchedKeyword: keyword };
  }

  return { ok: false, reason: 'missing_strict_keyword_match' };
}
