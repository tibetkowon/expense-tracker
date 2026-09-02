'use client';

export default function Toast({ message }: { message: string | null }) {
  if (message === null) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-[12px] text-white shadow-lg">
      {message}
    </div>
  );
}
