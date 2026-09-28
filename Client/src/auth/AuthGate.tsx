import { useEffect, useState, type ReactNode } from "react";
import { restore } from "./session.ts";
import { useSession } from "./permissions.tsx";
import { Login } from "../screens/Login.tsx";
import { ChangePassword } from "../screens/ChangePassword.tsx";

/**
 * What stands in front of the app: on load, a refresh cookie from an earlier
 * visit restores the session; without one, the login screen; while the user
 * must choose a password, only that screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    void restore().finally(() => setRestoring(false));
  }, []);

  if (restoring) return <div className="auth-screen" aria-busy="true" />;
  if (!session) return <Login />;
  if (session.mustChangePassword) return <ChangePassword />;
  return <>{children}</>;
}
