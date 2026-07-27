import { useCallback, useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth } from "../firebase";

export const ADMIN_EMAILS = ["sirsamyou@gmail.com", "polarusx@gmail.com"];

export interface AdminAuthState {
  user: FirebaseUser | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useAdminAuth(): AdminAuthState {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setIsAdmin(!!u && ADMIN_EMAILS.includes((u.email || "").toLowerCase()));
        setLoading(false);
      },
      (err) => {
        console.error("Auth state error:", err);
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  const login = useCallback(async () => {
    setError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/cancelled-popup-request"
      ) {
        // Mobile browsers routinely block popups — fall back to a full redirect.
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectErr) {
          console.error("Redirect login failed:", redirectErr);
        }
      }
      if (code === "auth/popup-closed-by-user") {
        setError("Sign-in window was closed before finishing.");
        return;
      }
      if (code === "auth/unauthorized-domain") {
        setError(
          `This domain (${typeof window !== "undefined" ? window.location.hostname : ""}) isn't in the Firebase "Authorized domains" list, so Google sign-in is blocked. Add it in Firebase Console → Authentication → Settings → Authorized domains.`,
        );
        return;
      }
      console.error("Login failed:", err);
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  return { user, isAdmin, loading, error, login, logout };
}
