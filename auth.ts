import NextAuth from 'next-auth';
import 'next-auth/jwt';
import Google from 'next-auth/providers/google';
import { isTokenExpired } from '@/lib/token';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        if (!account.access_token || !account.expires_at) {
          throw new TypeError('Missing access_token or expires_at from Google');
        }
        return {
          ...token,
          access_token: account.access_token,
          expires_at: account.expires_at,
          refresh_token: account.refresh_token,
        };
      }

      if (!isTokenExpired(token.expires_at as number)) {
        return token;
      }

      if (!token.refresh_token) {
        token.error = 'RefreshTokenError';
        return token;
      }

      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token as string,
          }),
        });
        const newTokens = await response.json();
        if (!response.ok) throw newTokens;

        return {
          ...token,
          access_token: newTokens.access_token,
          expires_at: Math.floor(Date.now() / 1000 + newTokens.expires_in),
          refresh_token: newTokens.refresh_token ?? token.refresh_token,
        };
      } catch (error) {
        console.error('Error refreshing access_token', error);
        token.error = 'RefreshTokenError';
        return token;
      }
    },
    async session({ session, token }) {
      session.accessToken = token.access_token as string;
      session.error = token.error as 'RefreshTokenError' | undefined;
      return session;
    },
  },
});

declare module 'next-auth' {
  interface Session {
    accessToken: string;
    error?: 'RefreshTokenError';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    access_token: string;
    expires_at: number;
    refresh_token?: string;
    error?: 'RefreshTokenError';
  }
}
