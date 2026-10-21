// Starts the earn loop when the Node.js server boots.
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.EARN_LOOP !== 'off') {
        const { getCtx } = await import('./server/runtime');

        getCtx();
    }
}
