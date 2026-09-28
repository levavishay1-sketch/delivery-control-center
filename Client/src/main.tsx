import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { SessionProvider } from "./auth/permissions.tsx";
import { AuthGate } from "./auth/AuthGate.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </SessionProvider>
  </React.StrictMode>,
);
