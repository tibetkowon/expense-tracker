export default function MonthlySummary({ total }: { total: number }) {
  const today = new Date();

  return (
    <section className="border-b border-gray-100 px-5 py-7">
      <div className="mb-1 text-[12px] text-gray-400">
        {today.getFullYear()}년 {today.getMonth() + 1}월 총 지출
      </div>
      <div className="text-[38px] font-bold tracking-tight text-gray-900">
        {total.toLocaleString('ko-KR')}원
      </div>
    </section>
  );
}
