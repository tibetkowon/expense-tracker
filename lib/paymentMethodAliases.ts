export type PaymentMethodEntry = { name: string; aliases: string[] };

export function parseAliases(value: string): string[] {
  return [...new Set(value.split(',').map((alias) => alias.trim()).filter(Boolean))];
}

const normalize = (value: string) => value.replace(/\s/g, '').toLowerCase();

export function matchPaymentMethod(text: string, method: string, entries: PaymentMethodEntry[]): string {
  const sources = [normalize(text), normalize(method)];
  let winner = method;
  let longest = 0;
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const needle = normalize(alias);
      if (!needle || needle.length <= longest) continue;
      const numeric = /^[\d-]+$/.test(needle);
      const matches = sources.some((source) => {
        let index = source.indexOf(needle);
        while (index !== -1) {
          if (!numeric || (!/[\d,]/.test(source[index - 1] ?? '') &&
            !/[\d,]/.test(source[index + needle.length] ?? ''))) return true;
          index = source.indexOf(needle, index + 1);
        }
        return false;
      });
      if (matches) { winner = entry.name; longest = needle.length; }
    }
  }
  return winner;
}
