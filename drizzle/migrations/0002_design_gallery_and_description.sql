ALTER TABLE public.designs
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description text;

UPDATE public.designs SET images = ARRAY['residential','residential-interior','floorplan'],
  description = 'A modern two bedroom apartment with an open-plan lounge and kitchen, two bathrooms and a private balcony. Ideal for rental blocks or a family home.'
  WHERE id = 'two-bedroom-apartment';
UPDATE public.designs SET images = ARRAY['residential','elevation','floorplan'],
  description = 'A classic family home with a striking front elevation, generous living spaces and a simple structure that keeps building costs low.'
  WHERE id = 'roller-castle';
UPDATE public.designs SET images = ARRAY['commercial','commercial-lobby','elevation'],
  description = 'A ten storey office and retail building with a glass facade, central core and flexible open floors that suit many tenants.'
  WHERE id = 'ten-storey-building';
UPDATE public.designs SET images = ARRAY['industrial','industrial-detail','elevation'],
  description = 'Structural layout and elevation drawings for a turbine housing, prepared for engineers and contractors.'
  WHERE id = 'turbine-design';
UPDATE public.designs SET images = ARRAY['industrial','industrial-detail','elevation'],
  description = 'A pedestrian and light vehicle bridge with steel and concrete details, spans and sections ready for costing.'
  WHERE id = 'bridge-design';
UPDATE public.designs SET images = ARRAY['urban','urban-aerial','floorplan'],
  description = 'A first floor layout for a mixed-use urban building, with shops below and apartments or offices above.'
  WHERE id = 'first-floor';
UPDATE public.designs SET images = ARRAY['urban','urban-aerial','elevation'],
  description = 'A grand entrance gate with bronze finishes, pillars and a guard house, designed to give any compound a premium first impression.'
  WHERE id = 'bronze-gate';
UPDATE public.designs SET images = ARRAY['interior','interior-detail','residential-interior'],
  description = 'Elegant gypsum ceiling designs with cove lighting for living rooms, dining areas and offices.'
  WHERE id = 'ceiling-design';
UPDATE public.designs SET images = ARRAY['interior','interior-detail','elevation'],
  description = 'A decorative single-leaf iron door with detailed patterns, sizes and fixing details for your fabricator.'
  WHERE id = 'iron-door';
UPDATE public.designs SET images = ARRAY['residential','floorplan','elevation'],
  description = 'Block layout and strengthening details for a durable, affordable house built with interlocking blocks.'
  WHERE id = 'sweet-strengthening-blocks';