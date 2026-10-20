// Starts the treasury loop when the Node.js server boots.
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.TREASURY_LOOP !== 'off') {
        const { getCtx } = await import('./server/runtime');

        getCtx();
    }
}
