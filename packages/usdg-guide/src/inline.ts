export type Segment = { text: string; href?: string };

// Splits "[text](url)" links out of a guide string.
export function segments(value: string): Segment[] {
    const out: Segment[] = [];
    const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;

    for (const match of value.matchAll(pattern)) {
        if (match.index > last) {
            out.push({ text: value.slice(last, match.index) });
        }

        out.push({ text: match[1]!, href: match[2]! });
        last = match.index + match[0].length;
    }

    if (last < value.length) {
        out.push({ text: value.slice(last) });
    }

    return out;
}
