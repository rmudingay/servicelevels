import { useEffect, useMemo, useState } from "react";
import type { ThemeMode } from "@service-levels/shared";

const cookieName = "ess_theme";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function useThemeMode(defaultMode: ThemeMode): [ThemeMode, (next: ThemeMode) => void] {
  const initial = useMemo<ThemeMode>(() => {
    const stored = readCookie(cookieName);
    return stored === "light" || stored === "dark" ? stored : defaultMode;
  }, [defaultMode]);
  const [mode, setMode] = useState<ThemeMode>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    writeCookie(cookieName, mode);
  }, [mode]);

  return [mode, setMode];
}
