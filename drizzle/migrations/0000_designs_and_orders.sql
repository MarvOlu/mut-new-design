CREATE TABLE public.designs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  unit TEXT,
  tag TEXT,
  image_key TEXT NOT NULL DEFAULT 'residential',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.designs TO anon, authenticated;
GRANT ALL ON public.designs TO service_role;

ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active designs"
ON public.designs FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  design_ids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  mpesa_receipt TEXT,
  result_desc TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders are only touched by the server (payment + download checks); no direct browser access.
GRANT ALL ON public.orders TO service_role;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX orders_checkout_request_idx ON public.orders (checkout_request_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_touch_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.designs (id, name, category, price, unit, tag, image_key, sort_order) VALUES
  ('two-bedroom-apartment', 'Two bedroom apartment', 'Residential', 4500, '2 pages', '15% OFF', 'residential', 1),
  ('roller-castle', 'Roller Castle', 'Residential', 1225, '1 page', 'Classic', 'residential', 2),
  ('ten-storey-building', 'Ten Storey building', 'Commercial', 13010, '5 pages', NULL, 'commercial', 3),
  ('turbine-design', 'Turbine Design', 'Commercial', 12800, '1 page', 'Fresh', 'industrial', 4),
  ('bridge-design', 'Bridge Design', 'Industrial', 15750, '4 pages', NULL, 'industrial', 5),
  ('first-floor', 'First Floor', 'Urban Design', 19000, '1 page', NULL, 'urban', 6),
  ('bronze-gate', 'Bronze Gate', 'Urban Design', 16200, '3 pages', 'Organic', 'urban', 7),
  ('ceiling-design', 'Ceiling Design', 'Interior Design', 14900, '5 pages', NULL, 'interior', 8),
  ('iron-door', 'Iron Door', 'Commercial', 14400, '1 leaf', NULL, 'interior', 9),
  ('sweet-strengthening-blocks', 'Sweet Strengthening blocks', 'Residential', 16000, '1 page', NULL, 'residential', 10);