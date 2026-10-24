import { createContext, useContext } from 'react';
import type { Runtime, User } from './types';

interface AuthContextValue {
  runtime: Runtime;
  user: User | null;
  endSession: (message: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('账号界面需要 AuthRoot。');
  return context;
}
