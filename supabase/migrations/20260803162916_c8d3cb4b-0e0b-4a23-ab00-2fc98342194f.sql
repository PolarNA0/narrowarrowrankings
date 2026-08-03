CREATE TABLE public.player_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_username text NOT NULL,
  category text NOT NULL,
  value smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_votes_category_chk CHECK (category IN ('official','hard','custom')),
  CONSTRAINT player_votes_value_chk CHECK (value IN (-1,1)),
  CONSTRAINT player_votes_unique UNIQUE (user_id, target_username, category)
);

GRANT SELECT ON public.player_votes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_votes TO authenticated;
GRANT ALL ON public.player_votes TO service_role;

ALTER TABLE public.player_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Votes are public" ON public.player_votes FOR SELECT USING (true);
CREATE POLICY "Users cast own votes" ON public.player_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own votes" ON public.player_votes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own votes" ON public.player_votes FOR DELETE TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX player_votes_target_idx ON public.player_votes (target_username);

CREATE TRIGGER touch_player_votes BEFORE UPDATE ON public.player_votes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();