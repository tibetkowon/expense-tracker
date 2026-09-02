import { auth, signIn, signOut } from '@/auth';

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Expense Tracker</h1>
      {session?.user ? (
        <>
          <p>{session.user.email}</p>
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button type="submit">Sign out</button>
          </form>
        </>
      ) : (
        <form
          action={async () => {
            'use server';
            await signIn('google');
          }}
        >
          <button type="submit">Sign in with Google</button>
        </form>
      )}
    </main>
  );
}
