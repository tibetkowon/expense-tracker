import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';

const { auth, signIn, signOut } = vi.hoisted(() => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth, signIn, signOut }));
vi.mock('@/components/ExpenseDashboard', () => ({
  default: () => <div>지출 대시보드</div>,
}));
vi.mock('@/components/FolderPicker', () => ({
  FolderPickerSection: () => <div>저장 위치 설정</div>,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(cleanup);

describe('홈 인증 상태', () => {
  it('세션이 없으면 동의를 강제하지 않고 로그인합니다', async () => {
    auth.mockResolvedValue(null);
    render(await Home());

    expect(screen.queryByText('지출 대시보드')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Google로 로그인' }));
    });
    expect(signIn).toHaveBeenCalledExactlyOnceWith('google');
  });

  it('정상 세션에서는 설정과 대시보드 및 로그아웃을 유지합니다', async () => {
    auth.mockResolvedValue({ user: { email: 'user@example.com' } });
    render(await Home());

    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText('저장 위치 설정')).toBeInTheDocument();
    expect(screen.getByText('지출 대시보드')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    });
    expect(signOut).toHaveBeenCalledExactlyOnceWith();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('토큰 갱신 오류에서는 복구 버튼으로 Google 동의를 요청합니다', async () => {
    auth.mockResolvedValue({
      user: { email: 'user@example.com' },
      error: 'RefreshTokenError',
    });
    render(await Home());

    expect(screen.getByRole('alert')).toHaveTextContent('Google 연결이 만료되었습니다.');
    expect(screen.queryByText('저장 위치 설정')).not.toBeInTheDocument();
    expect(screen.queryByText('지출 대시보드')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Google로 로그인' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Google 다시 연결' }));
    });
    expect(signIn).toHaveBeenCalledExactlyOnceWith('google', {}, { prompt: 'consent' });
  });
});
