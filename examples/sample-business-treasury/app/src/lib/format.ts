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
