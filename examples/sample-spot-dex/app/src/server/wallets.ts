// The three demo wallets in the trader app. Their keys stay on the server.
export type WalletId = 'lena' | 'omar' | 'priya';

export const WALLET_IDS: WalletId[] = ['lena', 'omar', 'priya'];

export const WALLETS: Record<WalletId, { name: string; role: 'lp' | 'trader' }> = {
    lena: { name: 'Lena', role: 'lp' },
    omar: { name: 'Omar', role: 'lp' },
    priya: { name: 'Priya', role: 'trader' },
};

// Who can sign: the Acme Swap operator or one of the demo wallets.
export type Who = 'operator' | WalletId;
