import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { Place, RouteOption } from '@/src/api/client';

export type FlowStatus = 'IDLE' | 'LISTENING' | 'CONFIRM_DESTINATION' | 'ROUTE_SELECTION' | 'NAVIGATING' | 'PAUSED' | 'CAMERA_ASSIST' | 'ERROR';
type State = { status: FlowStatus; destination: Place | null; routes: RouteOption[]; selectedRoute: RouteOption | null; stepIndex: number; demoMode: boolean; recentPlaces: Place[]; error: string | null };
type Action =
  | { type: 'STATUS'; status: FlowStatus }
  | { type: 'DESTINATION'; place: Place }
  | { type: 'ROUTES'; routes: RouteOption[] }
  | { type: 'SELECT_ROUTE'; route: RouteOption }
  | { type: 'STEP'; index: number }
  | { type: 'DEMO'; enabled: boolean }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

const initial: State = { status: 'IDLE', destination: null, routes: [], selectedRoute: null, stepIndex: 0, demoMode: false, recentPlaces: [], error: null };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'STATUS': return { ...state, status: action.status, error: null };
    case 'DESTINATION': return { ...state, destination: action.place, status: 'CONFIRM_DESTINATION', recentPlaces: [action.place, ...state.recentPlaces.filter((place) => place.id !== action.place.id)].slice(0, 3), error: null };
    case 'ROUTES': return { ...state, routes: action.routes, status: 'ROUTE_SELECTION', error: null };
    case 'SELECT_ROUTE': return { ...state, selectedRoute: action.route, stepIndex: 0, status: 'NAVIGATING' };
    case 'STEP': return { ...state, stepIndex: action.index };
    case 'DEMO': return { ...state, demoMode: action.enabled };
    case 'ERROR': return { ...state, status: 'ERROR', error: action.message };
    case 'RESET': return { ...initial, demoMode: state.demoMode, recentPlaces: state.recentPlaces };
  }
}

const StateContext = createContext<State | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stableState = useMemo(() => state, [state]);
  return <StateContext.Provider value={stableState}><DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider></StateContext.Provider>;
}
export function useNavigationState(): [State, Dispatch<Action>] {
  const state = useContext(StateContext); const dispatch = useContext(DispatchContext);
  if (!state || !dispatch) throw new Error('NavigationProvider is missing.');
  return [state, dispatch];
}
