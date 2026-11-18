import { useQuery } from "@tanstack/react-query";
import { ShoppingBasket } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { BasketSheet } from "@/components/shop/BasketSheet";
import { Button } from "@/components/ui/button";
import { addToBasket, parseStoredBasket, removeFromBasket } from "@/lib/basket";
import { designsQuery } from "@/lib/shop-queries";

const STORAGE_KEY = "mutken-basket";

interface BasketContextValue {
  ids: string[];
  has: (id: string) => boolean;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const BasketContext = createContext<BasketContextValue | null>(null);

const noop = () => {};
// Used only if a page renders outside the provider (e.g. mid hot-reload): the page still shows instead of going blank.
const EMPTY_BASKET: BasketContextValue = {
  ids: [],
  has: () => false,
  add: noop,
  remove: noop,
  toggle: noop,
  clear: noop,
  open: false,
  setOpen: noop,
};

export function useBasket() {
  return useContext(BasketContext) ?? EMPTY_BASKET;
}

export function BasketProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const { data: designs = [], isSuccess } = useQuery(designsQuery);

  useEffect(() => {
    try {
      setIds(parseStoredBasket(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      setIds([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || !isSuccess) return;
    const validIds = new Set(designs.map((d) => d.id));
    setIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [loaded, isSuccess, designs]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // Ignore storage restrictions in sandboxed iframes
    }
  }, [ids, loaded]);

  const add = useCallback((id: string) => setIds((b) => addToBasket(b, id)), []);
  const remove = useCallback((id: string) => setIds((b) => removeFromBasket(b, id)), []);
  const toggle = useCallback(
    (id: string) => setIds((b) => (b.includes(id) ? removeFromBasket(b, id) : addToBasket(b, id))),
    [],
  );
  const clear = useCallback(() => setIds([]), []);

  const value = useMemo<BasketContextValue>(
    () => ({ ids, has: (id) => ids.includes(id), add, remove, toggle, clear, open, setOpen }),
    [ids, add, remove, toggle, clear, open],
  );
  const items = designs.filter((d) => ids.includes(d.id));

  return (
    <BasketContext.Provider value={value}>
      {children}
      <BasketSheet
        open={open}
        onOpenChange={setOpen}
        items={items}
        onRemove={remove}
        onCleared={clear}
      />
    </BasketContext.Provider>
  );
}

export function BasketButton() {
  const { ids, setOpen } = useBasket();
  return (
    <Button
      variant="default"
      className="relative rounded-full"
      onClick={() => setOpen(true)}
      aria-label="Open basket"
    >
      <ShoppingBasket />
      <span className="hidden sm:inline">Basket</span>
      {ids.length > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-accent-foreground">
          {ids.length}
        </span>
      )}
    </Button>
  );
}
