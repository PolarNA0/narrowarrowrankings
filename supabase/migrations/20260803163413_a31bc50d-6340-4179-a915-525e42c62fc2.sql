CREATE TABLE IF NOT EXISTS public.player_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_username text NOT NULL,
  category text NOT NULL CHECK (category IN ('official','hard','custom')),
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_username, category)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_votes TO authenticated;
GRANT SELECT ON public.player_votes TO anon;
GRANT ALL ON public.player_votes TO service_role;

ALTER TABLE public.player_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Votes are public" ON public.player_votes;
CREATE POLICY "Votes are public" ON public.player_votes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users cast own votes" ON public.player_votes;
CREATE POLICY "Users cast own votes" ON public.player_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own votes" ON public.player_votes;
CREATE POLICY "Users update own votes" ON public.player_votes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own votes" ON public.player_votes;
CREATE POLICY "Users delete own votes" ON public.player_votes FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS touch_player_votes ON public.player_votes;
CREATE TRIGGER touch_player_votes BEFORE UPDATE ON public.player_votes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();