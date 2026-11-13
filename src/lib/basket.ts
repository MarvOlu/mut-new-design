/** Pure basket helpers: a basket is a list of design ids, each at most once. */
export function addToBasket(basket: string[], id: string): string[] {
  return basket.includes(id) ? basket : [...basket, id];
}

export function removeFromBasket(basket: string[], id: string): string[] {
  return basket.filter((x) => x !== id);
}

export function parseStoredBasket(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))].slice(0, 30) : [];
  } catch {
    return [];
  }
}
