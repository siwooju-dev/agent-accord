import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('PolicyGuard demo frontend', () => {
  it('shows the ready-to-approve flow with explicit mock labeling', () => {
    render(<App />);

    expect(screen.getByText('Mock 환경')).toBeInTheDocument();
    expect(screen.getByText(/정책 검사 통과/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /모의 구매 승인/ })).toBeEnabled();
    expect(screen.getByText(/실제 결제 없음/)).toBeInTheDocument();
  });

  it('shows a code-level budget block without an approval action', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /예산 차단/ }));

    expect(await screen.findByText('구매를 실행하지 않았습니다')).toBeInTheDocument();
    expect(screen.getByText(/12,900원 초과/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /모의 구매 승인/ })).not.toBeInTheDocument();
  });

  it('collects missing information before showing candidates', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /추가 질문/ }));

    expect(await screen.findByRole('heading', { name: '추가 정보가 필요해요' })).toBeInTheDocument();
    expect(screen.getByLabelText('추가 답변')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '추천 후보와 정책 검사' })).not.toBeInTheDocument();
  });

  it('separates simulated purchase success from pending chain evidence', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /모의 구매 승인/ }));

    expect(await screen.findByRole('heading', { name: '모의 구매 완료' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '체인 기록 대기' })).toBeInTheDocument();
    expect(screen.getByText('아직 발급되지 않음')).toBeInTheDocument();
  });
});
