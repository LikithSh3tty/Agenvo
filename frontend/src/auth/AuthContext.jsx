import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthChange, signIn, signUp, signInWithGoogle, sendReset, signOutUser, deleteAccount, getProviderId } from "./authClient.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until the first auth state resolves

  useEffect(() => {
    const unsub = onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    sendReset,
    signOut: signOutUser,
    deleteAccount,
    getProviderId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
