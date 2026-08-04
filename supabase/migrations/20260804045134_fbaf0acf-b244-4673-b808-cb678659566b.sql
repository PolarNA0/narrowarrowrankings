-- Lock down direct client writes to player_votes (server function validates instead)
DROP POLICY IF EXISTS "Users cast own votes" ON public.player_votes;
DROP POLICY IF EXISTS "Users update own votes" ON public.player_votes;
REVOKE INSERT, UPDATE ON public.player_votes FROM authenticated;
GRANT ALL ON public.player_votes TO service_role;

-- Ensure one vote per user/target/category
CREATE UNIQUE INDEX IF NOT EXISTS player_votes_unique_idx
  ON public.player_votes (user_id, target_username, category);

CREATE TABLE IF NOT EXISTS public.level_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, level_id)
);

GRANT SELECT, DELETE ON public.level_ratings TO authenticated;
GRANT SELECT ON public.level_ratings TO anon;
GRANT ALL ON public.level_ratings TO service_role;

ALTER TABLE public.level_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ratings are public" ON public.level_ratings
  FOR SELECT USING (true);

CREATE POLICY "Users delete own ratings" ON public.level_ratings
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage ratings" ON public.level_ratings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_level_ratings
  BEFORE UPDATE ON public.level_ratings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();