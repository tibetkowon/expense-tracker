import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  globalIgnores(['docs/**', 'coverage/**']),
  {
    files: [
      'components/ExpenseDashboard.tsx',
      'components/ExpenseForm.tsx',
      'components/FileNameSetting.tsx',
      'components/FolderPicker.tsx',
    ],
    rules: {
      // 기존 데이터 로딩과 폼 초기값 동기화는 동작을 유지하면서 경고로 추적합니다.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
