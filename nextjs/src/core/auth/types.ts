export interface UserProfile {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
    role?: 'admin' | 'developer' | 'viewer';
}

export interface UserSession {
    user: UserProfile;
    accessToken?: string;
    expiresAt?: string;
}

export type AuthMode = 'oidc' | 'disabled';
