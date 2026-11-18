export interface Category {
  name: string;
  emoji: string;
  sort_order: number;
}

/** Shop category cards: only categories that have at least one design on sale, in the owner's order. */
export function visibleCategories(
  categories: Category[],
  designs: { category: string }[],
): Category[] {
  const used = new Set(designs.map((d) => d.category));
  return [...categories]
    .filter((c) => used.has(c.name))
    .sort((a, b) => a.sort_order - b.sort_order);
}
