// Starts the DEX loop when the Node.js server boots.
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DEX_LOOP !== 'off') {
        const { getCtx } = await import('./server/runtime');

        await getCtx();
    }
}
