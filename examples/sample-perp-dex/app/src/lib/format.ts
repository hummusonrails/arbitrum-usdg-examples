// Formats a decimal string amount with thousands separators, keeping at
// least two and at most six decimals. Never goes through a float.
export function formatAmount(value: string | null | undefined): string {
    if (!value) {
        return '0.00';
    }

    const [whole = '0', frac = ''] = value.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const decimals = frac.replace(/0+$/, '').padEnd(2, '0').slice(0, 6);

    return `${grouped}.${decimals}`;
}

export function shortAddress(value: string | null | undefined): string {
    return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '';
}

export function timeOf(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

// A feed line shows the event type and the first block of its id.
export function feedText(text: string): string {
    return text.replace(/([0-9a-f]{8})-[0-9a-f-]{27}/gi, '$1');
}

// Rounds a decimal string to cents for the customer's eyes, so tiny rounding
// from vault share math never shows as a loss. Never goes through a float.
export function formatMoney(value: string | null | undefined): string {
    const v = value ?? '0';
    const negative = v.startsWith('-');
    const [whole = '0', frac = ''] = v.replace('-', '').split('.');
    const thousandths = BigInt(whole) * 1000n + BigInt((frac + '000').slice(0, 3));
    const rounded = (thousandths + 5n) / 10n;
    const text = formatAmount(
        `${rounded / 100n}.${(rounded % 100n).toString().padStart(2, '0')}`,
    );

    return negative && rounded !== 0n ? `-${text}` : text;
}
