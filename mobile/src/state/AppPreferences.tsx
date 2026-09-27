import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type RoutePriority = 'balanced' | 'fastest' | 'quietest' | 'stepFree';

type Preferences = {
  routePriority: RoutePriority;
  avoidConstruction: boolean;
  preferWellLit: boolean;
  noiseAlerts: boolean;
  email: string | null;
  setRoutePriority: (value: RoutePriority) => void;
  setAvoidConstruction: (value: boolean) => void;
  setPreferWellLit: (value: boolean) => void;
  setNoiseAlerts: (value: boolean) => void;
  signIn: (email: string) => void;
  signOut: () => void;
};

const Context = createContext<Preferences | null>(null);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [routePriority, setRoutePriority] = useState<RoutePriority>('balanced');
  const [avoidConstruction, setAvoidConstruction] = useState(true);
  const [preferWellLit, setPreferWellLit] = useState(false);
  const [noiseAlerts, setNoiseAlerts] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const value = useMemo(() => ({
    routePriority, avoidConstruction, preferWellLit, noiseAlerts, email,
    setRoutePriority, setAvoidConstruction, setPreferWellLit, setNoiseAlerts,
    signIn: (nextEmail: string) => setEmail(nextEmail.trim().toLowerCase()),
    signOut: () => setEmail(null),
  }), [routePriority, avoidConstruction, preferWellLit, noiseAlerts, email]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('AppPreferencesProvider missing');
  return value;
}
