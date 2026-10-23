import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface AccountAuthState {
  user: User | null;
  /** True while the stored session is still being read. */
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * The player's session, and nothing else.
 *
 * This is deliberately separate from `useAdminAuth`: signing in to play is not
 * the same act as holding admin, and the two must not be able to imply each
 * other. Admin is read from `user_roles` where it is needed, not here.
 */
export function useAccountAuth(): AccountAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const { signInWithUsername } = await import("@/lib/accounts");
    await signInWithUsername(username, password);
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    const { signUpWithUsername } = await import("@/lib/accounts");
    await signUpWithUsername(username, password);
  }, []);

  const signOut = useCallback(async () => {
    const { signOutAccount } = await import("@/lib/accounts");
    await signOutAccount();
  }, []);

  return { user, loading, signIn, signUp, signOut };
}

/**
 * True when the signed-in user holds the admin role. Separate from being signed in.
 *
 * The allow-list claim is attempted first: an allow-listed account is granted the
 * role on its first sign-in, and signing in through the profile dialog must not
 * leave an admin without the role just because they never opened the admin panel.
 */
export function useIsAdmin(userId?: string | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let alive = true;

    const readRole = async (): Promise<boolean> => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    };

    void (async () => {
      let admin = await readRole();
      if (!admin) {
        try {
          const { claimAdmin } = await import("@/lib/admin.functions");
          const result = await claimAdmin();
          if (result.isAdmin) admin = await readRole();
        } catch (err) {
          console.error("Admin claim failed:", err);
        }
      }
      if (alive) setIsAdmin(admin);
    })();

    return () => {
      alive = false;
    };
  }, [userId]);

  return isAdmin;
}
