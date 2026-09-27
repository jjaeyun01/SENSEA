import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { useAuth, type UserPreferences } from '../auth/AuthProvider';

export type RoutePriority = UserPreferences['route_priority'];

type Preferences = {
  routePriority: RoutePriority;
  avoidConstruction: boolean;
  preferWellLit: boolean;
  setRoutePriority: (value: RoutePriority) => Promise<void>;
  setAvoidConstruction: (value: boolean) => Promise<void>;
  setPreferWellLit: (value: boolean) => void;
};

const Context = createContext<Preferences | null>(null);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [guestPriority, setGuestPriority] = useState<RoutePriority>('safety');
  const [guestAvoidConstruction, setGuestAvoidConstruction] = useState(true);
  // The account schema has no lighting switch yet. It remains a session setting
  // until a migration and verified lighting data source exist.
  const [preferWellLit, setPreferWellLit] = useState(false);
  const routePriority = auth.user ? auth.preferences?.route_priority ?? 'safety' : guestPriority;
  const avoidConstruction = auth.user ? auth.preferences?.avoid_construction ?? true : guestAvoidConstruction;
  const value = useMemo<Preferences>(() => ({
    routePriority, avoidConstruction, preferWellLit,
    setRoutePriority: async next => {
      if (auth.user) await auth.updatePreferences({ route_priority: next });
      else setGuestPriority(next);
    },
    setAvoidConstruction: async next => {
      if (auth.user) await auth.updatePreferences({ avoid_construction: next });
      else setGuestAvoidConstruction(next);
    },
    setPreferWellLit,
  }), [auth.user, auth.updatePreferences, routePriority, avoidConstruction, preferWellLit]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('AppPreferencesProvider missing');
  return value;
}
