-- Votes: own rows only; public totals via function
DROP POLICY IF EXISTS "Votes are public" ON public.player_votes;
CREATE POLICY "Users read own votes" ON public.player_votes FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_vote_totals()
RETURNS TABLE(target_username text, category text, total bigint, voters bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target_username, category, SUM(value)::bigint, COUNT(DISTINCT user_id)::bigint
  FROM public.player_votes GROUP BY target_username, category
$$;
GRANT EXECUTE ON FUNCTION public.get_vote_totals() TO anon, authenticated;

-- Ratings: own rows only; public averages via function
DROP POLICY IF EXISTS "Ratings are public" ON public.level_ratings;
CREATE POLICY "Users read own ratings" ON public.level_ratings FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_rating_summaries()
RETURNS TABLE(level_id text, average numeric, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT level_id, AVG(rating)::numeric, COUNT(*)::bigint FROM public.level_ratings GROUP BY level_id
$$;
GRANT EXECUTE ON FUNCTION public.get_rating_summaries() TO anon, authenticated;

-- Profiles: table rows own/admin only; public directory without account ids
DROP POLICY IF EXISTS "Profiles are public" ON public.player_profiles;
CREATE POLICY "Users read own profile" ON public.player_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_public_profiles()
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, banner_url text,
  accent_color text, bio text, country text, socials jsonb, verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, username, display_name, avatar_url, banner_url, accent_color, bio, country, socials, verified
  FROM public.player_profiles
$$;
GRANT EXECUTE ON FUNCTION public.get_public_profiles() TO anon, authenticated;

-- App docs: hide tracker config/state from non-admins
DROP POLICY IF EXISTS "Anyone can read docs" ON public.app_docs;
CREATE POLICY "Anyone can read public docs" ON public.app_docs FOR SELECT TO anon, authenticated
  USING (NOT (collection = 'configs' AND doc_id IN ('discordTracker', 'categoryRecordState')));