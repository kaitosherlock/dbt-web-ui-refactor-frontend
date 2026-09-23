import { getSession, signOut } from 'next-auth/react';
import type { UserProfile, UserSession } from './types';

export const authApi = {
    async getSession(): Promise<UserSession | null> {
        const session = await getSession();
        if (!session?.user) return null;
        return {
            user: {
                id: (session.user as { id?: string }).id || session.user.email || 'user',
                email: session.user.email || '',
                name: session.user.name,
                image: session.user.image,
                role: (session.user as { role?: 'admin' | 'developer' | 'viewer' }).role || 'developer',
            },
            accessToken: session.accessToken as string | undefined,
        };
    },

    async logout(callbackUrl: string = '/login') {
        await signOut({ callbackUrl });
    },
};
