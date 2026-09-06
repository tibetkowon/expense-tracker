export default function MonthlySummary({ total, month }: { total: number; month: string }) {
  const [year, monthNumber] = month.split('-');

  return (
    <section className="border-b border-gray-100 px-5 py-7">
      <div className="mb-1 text-[12px] text-gray-400">
        {year}년 {Number(monthNumber)}월 총 지출
      </div>
      <div className="text-[38px] font-bold tracking-tight text-gray-900">
        {total.toLocaleString('ko-KR')}원
      </div>
    </section>
  );
}
