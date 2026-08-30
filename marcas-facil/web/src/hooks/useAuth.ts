/**
 * Hook de autenticación — MARCAS FÁCIL
 */
import { create } from 'zustand';
import { authApi } from '../services/api';
import type { User } from '../types';

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    email: string; password: string; nombre: string;
    cuit?: string; razonSocial?: string; codigoReseller?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

// Inicializar desde localStorage
const storedToken = localStorage.getItem('mf_token');
const storedUser = localStorage.getItem('mf_user');
let initialUser: User | null = null;
try {
  if (storedUser) initialUser = JSON.parse(storedUser);
} catch { /* nada */ }

export const useAuth = create<AuthStore>((set, get) => ({
  user: initialUser,
  token: storedToken,
  isAuthenticated: !!storedToken && !!initialUser,
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const { token, user } = await authApi.login(email, password);
      localStorage.setItem('mf_token', token);
      localStorage.setItem('mf_user', JSON.stringify(user));
      set({ user, token, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (payload) => {
    set({ isLoading: true });
    try {
      const { token, user } = await authApi.register(payload);
      localStorage.setItem('mf_token', token);
      localStorage.setItem('mf_user', JSON.stringify(user));
      set({ user, token, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('mf_token');
    localStorage.removeItem('mf_user');
    set({ user: null, token: null, isAuthenticated: false });
    window.location.href = '/login';
  },

  refreshUser: async () => {
    try {
      const user = await authApi.me();
      localStorage.setItem('mf_user', JSON.stringify(user));
      set({ user });
    } catch { get().logout(); }
  },
}));
