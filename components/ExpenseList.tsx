import type { ExpenseRowWithNumber } from '@/lib/sheets';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}.${day}(${weekdays[date.getDay()]})`;
}

type ExpenseListProps = {
  expenses: ExpenseRowWithNumber[];
  onEdit: (expense: ExpenseRowWithNumber) => void;
  onDelete: (expense: ExpenseRowWithNumber) => Promise<void>;
};

export default function ExpenseList({ expenses, onEdit, onDelete }: ExpenseListProps) {
  return (
    <section className="px-5 py-6 pb-10">
      <h2 className="mb-1 text-[13px] font-semibold text-gray-800">최근 내역</h2>
      {expenses.map((expense) => (
        <div key={expense.rowNumber} className="flex items-center justify-between border-b border-gray-50 py-3">
          <div className="flex flex-col">
            <span className="text-[11px] text-gray-400">{dateLabel(expense.date)} · {expense.category}</span>
            <span className="text-[14px] text-gray-800">{expense.memo}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[15px] font-semibold text-gray-900">{expense.amount.toLocaleString('ko-KR')}원</span>
            <span className="text-[11px] text-gray-400">{expense.method}</span>
            <div className="mt-1 flex gap-3">
              <button type="button" onClick={() => onEdit(expense)} className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300">
                수정
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('정말 삭제하시겠어요?')) void onDelete(expense);
                }}
                className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
