'use client';

type MonthSelectorProps = {
  months: string[];
  selected: string;
  onChange: (month: string) => void;
};

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}년 ${Number(monthNumber)}월`;
}

export default function MonthSelector({ months, selected, onChange }: MonthSelectorProps) {
  if (months.length === 0) return null;

  return (
    <select
      value={selected}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[13px] font-medium text-gray-700"
    >
      {months.map((month) => (
        <option key={month} value={month}>
          {formatMonthLabel(month)}
        </option>
      ))}
    </select>
  );
}
