import { createContext, useContext } from 'react';

const DirectorRefreshContext = createContext(null);

export function DirectorRefreshProvider({ onRefresh, children }) {
  const value = typeof onRefresh === 'function' ? onRefresh : null;
  return <DirectorRefreshContext.Provider value={value}>{children}</DirectorRefreshContext.Provider>;
}

export function useDirectorRevisionRefresh() {
  return useContext(DirectorRefreshContext);
}
