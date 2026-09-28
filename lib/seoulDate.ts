export function formatSeoulDate(date: Date): string {
  // KST는 DST 없이 항상 UTC+9이므로 서버의 로컬 타임존에 의존하지 않는다.
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
