import { describe, expect, it } from 'vitest';
import { matchPaymentMethod, parseAliases } from './paymentMethodAliases';

describe('알림 표기 매칭', () => {
  const entries = [{ name: '카드', aliases: ['1234', 'Deep Dream', '123-45-6789'] }];
  it.each(['승인 (1234)', 'DEEP   dream 승인', '계좌 123-45-6789 출금', '91234 (1234)'])('%s를 매칭합니다', (text) => {
    expect(matchPaymentMethod(text, '', entries)).toBe('카드');
  });
  it.each(['11,234원', '91234', '12345', '1,1234', '1234,000', '9123-45-6789', '123-45-67890'])('%s를 오매칭하지 않습니다', (text) => {
    expect(matchPaymentMethod(text, '원본', entries)).toBe('원본');
  });
  it('추출 문자열에서도 매칭하고 공백 별칭은 무시합니다', () => {
    expect(matchPaymentMethod('', 'deepdream', entries)).toBe('카드');
    expect(matchPaymentMethod('', '', [{ name: '빈 표기', aliases: [' '] }])).toBe('');
  });
  it('정규화한 긴 별칭을 우선하고 동률이면 위 행을 선택합니다', () => {
    expect(matchPaymentMethod('Deep Dream', '', [
      { name: '짧음', aliases: ['deep'] }, { name: '첫째', aliases: ['deep dream'] }, { name: '둘째', aliases: ['DEEPDREAM'] },
    ])).toBe('첫째');
  });
  it('쉼표 목록은 공백과 빈 항목, 정확히 같은 중복만 제거합니다', () => {
    expect(parseAliases(' a, ,a, A , b ')).toEqual(['a', 'A', 'b']);
  });
});
