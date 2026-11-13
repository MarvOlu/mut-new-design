-- ===== Admin roles =====
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can see their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- Email addresses that become dashboard admins once the address is confirmed.
CREATE TABLE public.admin_emails (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_emails TO service_role;
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
INSERT INTO public.admin_emails (email) VALUES ('oluoch540@gmail.com') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_listed_admin_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.email_confirmed_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.admin_emails WHERE email = lower(NEW.email)) THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'grant_listed_admin_role failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_grant_admin
AFTER INSERT OR UPDATE OF email_confirmed_at, email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_listed_admin_role();

-- ===== Categories =====
CREATE TABLE public.categories (
  name TEXT PRIMARY KEY CHECK (length(trim(name)) > 0),
  emoji TEXT NOT NULL DEFAULT '📐',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view categories" ON public.categories
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can add categories" ON public.categories
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update categories" ON public.categories
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete categories" ON public.categories
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.categories (name, emoji, sort_order) VALUES
  ('Residential', '🏠', 1),
  ('Commercial', '🌆', 2),
  ('Industrial', '🏗', 3),
  ('Urban Design', '🗼', 4),
  ('Interior Design', '💠', 5)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (name, sort_order)
  SELECT DISTINCT category, 100 FROM public.designs
ON CONFLICT DO NOTHING;

ALTER TABLE public.designs
  ADD CONSTRAINT designs_category_fkey FOREIGN KEY (category)
  REFERENCES public.categories(name) ON UPDATE CASCADE ON DELETE RESTRICT;

-- ===== Designs: admins manage everything =====
GRANT INSERT, UPDATE, DELETE ON public.designs TO authenticated;
CREATE POLICY "Admins can view all designs" ON public.designs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can add designs" ON public.designs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update designs" ON public.designs
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete designs" ON public.designs
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Buyers keep their downloads: a design that was ever ordered can only be hidden, not deleted.
CREATE OR REPLACE FUNCTION public.prevent_ordered_design_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE OLD.id = ANY (design_ids)) THEN
    RAISE EXCEPTION 'This design is part of existing orders. Hide it from the shop instead.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER designs_prevent_ordered_delete
BEFORE DELETE ON public.designs
FOR EACH ROW EXECUTE FUNCTION public.prevent_ordered_design_delete();

-- ===== Orders: admins can read, records of every step =====
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
GRANT SELECT ON public.orders TO authenticated;
CREATE POLICY "Admins can view orders" ON public.orders
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders (created_at DESC);

CREATE TABLE public.order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.order_events TO authenticated;
GRANT ALL ON public.order_events TO service_role;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view order records" ON public.order_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX order_events_order_idx ON public.order_events (order_id, created_at);
CREATE INDEX order_events_created_idx ON public.order_events (created_at DESC);

CREATE OR REPLACE FUNCTION public.log_order_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (order_id, kind, message, detail)
    VALUES (NEW.id, 'created', 'Order placed',
      jsonb_build_object('amount', NEW.amount, 'phone', NEW.phone, 'designs', to_jsonb(NEW.design_ids)));
    RETURN NEW;
  END IF;

  IF NEW.checkout_request_id IS NOT NULL AND NEW.checkout_request_id IS DISTINCT FROM OLD.checkout_request_id THEN
    INSERT INTO public.order_events (order_id, kind, message, detail)
    VALUES (NEW.id, 'prompt_sent', 'M-PESA prompt sent to the buyer''s phone',
      jsonb_build_object('amount', NEW.amount, 'checkout_request_id', NEW.checkout_request_id));
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paid' THEN
      INSERT INTO public.order_events (order_id, kind, message, detail)
      VALUES (NEW.id, 'paid', 'Payment received',
        jsonb_build_object('amount', NEW.amount, 'receipt', NEW.mpesa_receipt));
    ELSIF NEW.status = 'failed' THEN
      INSERT INTO public.order_events (order_id, kind, message, detail)
      VALUES (NEW.id, 'failed', coalesce(NEW.result_desc, 'Payment not completed'),
        jsonb_build_object('amount', NEW.amount));
    END IF;
  END IF;

  IF NEW.mpesa_receipt IS NOT NULL AND OLD.mpesa_receipt IS NULL AND NEW.status = OLD.status THEN
    INSERT INTO public.order_events (order_id, kind, message, detail)
    VALUES (NEW.id, 'receipt', 'M-PESA receipt recorded', jsonb_build_object('receipt', NEW.mpesa_receipt));
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_log_events
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.log_order_event();

-- Backfill records for orders placed before records existed.
INSERT INTO public.order_events (order_id, kind, message, detail, created_at)
  SELECT id, 'created', 'Order placed',
    jsonb_build_object('amount', amount, 'phone', phone, 'designs', to_jsonb(design_ids)), created_at
  FROM public.orders;
INSERT INTO public.order_events (order_id, kind, message, detail, created_at)
  SELECT id, 'failed', coalesce(result_desc, 'Payment not completed'), jsonb_build_object('amount', amount), updated_at
  FROM public.orders WHERE status = 'failed';
INSERT INTO public.order_events (order_id, kind, message, detail, created_at)
  SELECT id, 'paid', 'Payment received', jsonb_build_object('amount', amount, 'receipt', mpesa_receipt), coalesce(paid_at, updated_at)
  FROM public.orders WHERE status = 'paid';

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders, public.order_events;

-- ===== Page maker content =====
CREATE TABLE public.site_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view site content" ON public.site_settings
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can add site content" ON public.site_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update site content" ON public.site_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.site_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TRIGGER site_settings_touch_updated_at
BEFORE UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Storage: admins manage pictures and download files =====
CREATE POLICY "Admins can view shop files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('designs', 'design-images') AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can upload shop files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('designs', 'design-images') AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can replace shop files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('designs', 'design-images') AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id IN ('designs', 'design-images') AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete shop files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('designs', 'design-images') AND public.has_role(auth.uid(), 'admin'));