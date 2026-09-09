import { auth, signIn, signOut } from '@/auth';
import ExpenseDashboard from '@/components/ExpenseDashboard';
import { FolderPickerSection } from '@/components/FolderPicker';

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex h-full min-h-screen w-full flex-col overflow-y-auto bg-white pt-[54px]">
      {session?.user && session.error === 'RefreshTokenError' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5">
          <p role="alert" className="text-center text-[14px] text-gray-700">
            Google 연결이 만료되었습니다. 다시 동의하여 연결을 복구해 주세요.
          </p>
          <form
            action={async () => {
              'use server';
              await signIn('google', {}, { prompt: 'consent' });
            }}
          >
            <button type="submit" className="rounded-full bg-indigo-600 px-6 py-3 text-[14px] font-semibold text-white active:bg-indigo-700">
              Google 다시 연결
            </button>
          </form>
        </div>
      ) : session?.user ? (
        <>
          <div className="flex items-center justify-between border-b border-gray-100 px-5 pb-4">
            <div className="flex flex-col">
              <span className="text-[11px] text-gray-400">로그인 계정</span>
              <span className="text-[13px] font-medium text-gray-700">{session.user.email}</span>
            </div>
            <form
              action={async () => {
                'use server';
                await signOut();
              }}
            >
              <button type="submit" className="text-[13px] font-medium text-gray-400">
                로그아웃
              </button>
            </form>
          </div>
          <FolderPickerSection />
          <ExpenseDashboard />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center px-5">
          <form
            action={async () => {
              'use server';
              await signIn('google');
            }}
          >
            <button type="submit" className="rounded-full bg-indigo-600 px-6 py-3 text-[14px] font-semibold text-white active:bg-indigo-700">
              Google로 로그인
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
