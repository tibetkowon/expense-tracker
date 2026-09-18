import type { PendingRowWithNumber } from '@/lib/pending';

type PendingListProps = {
  items: PendingRowWithNumber[];
  onConfirmPayment: (item: PendingRowWithNumber) => void;
  onDismiss: (item: PendingRowWithNumber) => void | Promise<void>;
};

export default function PendingList({ items, onConfirmPayment, onDismiss }: PendingListProps) {
  if (items.length === 0) return null;

  return (
    <section className="border-b border-gray-100 px-5 py-6">
      <h2 className="mb-1 text-[13px] font-semibold text-gray-800">확인 대기 ({items.length})</h2>
      {items.map((item) => (
        <div key={item.rowNumber} className="border-b border-gray-50 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-gray-400">{item.date} · {item.category} · {item.type}</p>
              <p className="break-words text-[14px] text-gray-800">{item.memo}</p>
            </div>
            <span className="shrink-0 text-[15px] font-semibold text-gray-900">{item.amount.toLocaleString('ko-KR')}원</span>
          </div>
          {item.type === '취소' ? (
            <p className="mt-2 text-[12px] text-gray-500">이 거래를 지출 목록에서 찾아 삭제해 주세요</p>
          ) : null}
          <p className="mt-2 break-words text-[12px] text-gray-500">{item.rawText}</p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (item.type === '결제') onConfirmPayment(item);
                else void onDismiss(item);
              }}
              className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300"
            >
              확인
            </button>
            {item.type === '결제' ? (
              <button type="button" onClick={() => void onDismiss(item)} className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300">
                무시
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}
