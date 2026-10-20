import {
    CONTACT,
    DISCLAIMER,
    INTRO,
    PATHS,
    STEPS,
    STRENGTHS,
    TITLE,
    USDG_PAGE,
} from './content.ts';

// The guide as a README section.
export function readmeSection(): string {
    return [
        `## ${TITLE}`,
        '',
        `${INTRO} [Learn about USDG on Arbitrum](${USDG_PAGE}) or [talk to the Arbitrum team](${CONTACT}).`,
        '',
        '### Ways to build with USDG',
        '',
        ...PATHS.map((p) => `- **${p.title}:** ${p.body}`),
        '',
        '### Why Arbitrum is a great home for USDG',
        '',
        ...STRENGTHS.map((s) => `- **${s.title}:** ${s.body}`),
        '',
        '### Start building',
        '',
        '1. **Run an example:** pick one from the table above and start it in mock mode, no accounts needed.',
        ...STEPS.map((s, i) => `${i + 2}. **${s.title}:** ${s.body}`),
        '',
        `<sub>${DISCLAIMER}</sub>`,
    ].join('\n');
}
