'use client';

import { useSession } from 'next-auth/react';
import type { UserProfile } from './types';

export function useAuth() {
    const { data: session, status } = useSession();

    const user: UserProfile | null = session?.user
        ? {
              id: (session.user as { id?: string }).id || session.user.email || 'user',
              email: session.user.email || '',
              name: session.user.name,
              image: session.user.image,
              role: (session.user as { role?: 'admin' | 'developer' | 'viewer' }).role || 'developer',
          }
        : null;

    return {
        user,
        isAuthenticated: status === 'authenticated',
        isLoading: status === 'loading',
        session,
    };
}
