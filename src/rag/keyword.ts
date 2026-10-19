// Keyword side of the hybrid search (BM25). Embeddings find meaning ("frete" ≈ shippingCost); exact
// names (a function, an error code) are found better by words. Identifiers are split
// (shippingCost → shipping, cost) and also kept whole.

const K1 = 1.2;
const B = 0.75;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.match(/[A-Za-zÀ-ÿ0-9_$]+/g) ?? []) {
    const lower = word.toLowerCase();
    if (lower.length < 2) continue;
    tokens.push(lower);
    const parts = word
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[\s_$]+/)
      .map((part) => part.toLowerCase())
      .filter((part) => part.length >= 2 && part !== lower);
    tokens.push(...parts);
  }
  return tokens;
}

export interface KeywordIndex {
  search: (query: string, limit: number) => { index: number; score: number }[];
}

export function buildKeywordIndex(texts: string[]): KeywordIndex {
  const postings = new Map<string, Map<number, number>>();
  const lengths = texts.map((text, index) => {
    const tokens = tokenize(text);
    for (const token of tokens) {
      const list = postings.get(token) ?? new Map<number, number>();
      list.set(index, (list.get(index) ?? 0) + 1);
      postings.set(token, list);
    }
    return tokens.length;
  });
  const average = lengths.reduce((sum, length) => sum + length, 0) / Math.max(lengths.length, 1);

  return {
    search(query: string, limit: number) {
      const scores = new Map<number, number>();
      for (const token of new Set(tokenize(query))) {
        const list = postings.get(token);
        if (!list) continue;
        const idf = Math.log(1 + (texts.length - list.size + 0.5) / (list.size + 0.5));
        for (const [index, frequency] of list) {
          const norm = frequency + K1 * (1 - B + (B * lengths[index]) / average);
          scores.set(index, (scores.get(index) ?? 0) + (idf * frequency * (K1 + 1)) / norm);
        }
      }
      return [...scores.entries()]
        .map(([index, score]) => ({ index, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}
