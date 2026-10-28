// The three demo traders in the trader app. Their keys stay on the server.
export type WalletId = 'ana' | 'kofi' | 'mei';

export const WALLET_IDS: WalletId[] = ['ana', 'kofi', 'mei'];

export const WALLETS: Record<WalletId, { name: string }> = {
    ana: { name: 'Ana' },
    kofi: { name: 'Kofi' },
    mei: { name: 'Mei' },
};

// Who can sign: the Acme Perps operator, its keeper, or a demo trader.
export type Who = 'operator' | 'keeper' | WalletId;
