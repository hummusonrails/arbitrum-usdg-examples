// Moves USDG between Arbitrum and Ethereum through the Paxos LayerZero OFT.
// The OFT burns USDG on the source chain and LayerZero delivers a message that
// mints the same amount on the destination.
import {
    OFT,
    oftAbi,
    toBytes32,
    USDG,
    USDG_DECIMALS,
    USDG_ETHEREUM,
} from '@arbitrum-usdg/usdg';
import { erc20Abi, type Address, type Hex } from 'viem';

import { ActionError, submit, type Network } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { getKv, record } from './db.ts';
import { checkBalance, format } from './trade.ts';
import { WALLET_IDS, WALLETS, type WalletId } from './wallets.ts';

export const SIDES: Record<
    Network,
    {
        oft: (typeof OFT)[keyof typeof OFT];
        usdg: Address;
        label: string;
        other: Network;
    }
> = {
    arbitrum: {
        oft: OFT.arbitrumOne,
        usdg: USDG.arbitrumOne.address,
        label: 'Arbitrum',
        other: 'ethereum',
    },
    ethereum: {
        oft: OFT.ethereum,
        usdg: USDG_ETHEREUM,
        label: 'Ethereum',
        other: 'arbitrum',
    },
};

function sendParam(to: Address, dstEid: number, amount: bigint) {
    return {
        dstEid,
        to: toBytes32(to),
        amountLD: amount,
        // USDG converts 1:1 across chains, so nothing may be lost in transit.
        minAmountLD: amount,
        extraOptions: '0x',
        composeMsg: '0x',
        oftCmd: '0x',
    } as const;
}

export async function usdgOn(ctx: Ctx, network: Network, account: Address) {
    return ctx.chains.clients[network].readContract({
        address: SIDES[network].usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
    });
}

// The LayerZero fee for a send, and how much Paxos's rate limit lets through now.
export async function quoteMove(ctx: Ctx, from: Network, amount: bigint, to?: Address) {
    const side = SIDES[from];
    const client = ctx.chains.clients[from];
    const dstEid = SIDES[side.other].oft.eid;
    const param = sendParam(to ?? ctx.chains.address('operator'), dstEid, amount);
    const [fee, [, canSend]] = await Promise.all([
        client.readContract({
            address: side.oft.address,
            abi: oftAbi,
            functionName: 'quoteSend',
            args: [param, false],
        }),
        client.readContract({
            address: side.oft.address,
            abi: oftAbi,
            functionName: 'getAmountCanBeSent',
            args: [dstEid],
        }),
    ]);

    return { param, fee, canSend };
}

export async function move(ctx: Ctx, who: WalletId, from: Network, amount: bigint) {
    const side = SIDES[from];
    const account = ctx.chains.address(who);
    const { param, fee, canSend } = await quoteMove(ctx, from, amount, account);

    checkBalance(await usdgOn(ctx, from, account), amount, 'USDG', USDG_DECIMALS);

    if (amount > canSend) {
        throw new ActionError(
            `Paxos limits how much USDG can cross per day. ${format(canSend, USDG_DECIMALS, 'USDG')} can be sent to ${SIDES[side.other].label} right now.`,
        );
    }

    const eth = await ctx.chains.clients[from].getBalance({ address: account });

    checkBalance(eth, fee.nativeFee, `ETH on ${side.label} for the LayerZero fee`, 18);

    const receipt = await submit(ctx.chains, who, from, {
        address: side.oft.address,
        abi: oftAbi,
        functionName: 'send',
        args: [param, fee, account],
        value: fee.nativeFee,
    });

    record(ctx.db, {
        kind: 'move',
        who,
        summary: `${WALLETS[who].name} sent ${format(amount, USDG_DECIMALS, 'USDG')} from ${side.label} to ${SIDES[side.other].label}: OFT.send, fee ${format(fee.nativeFee, 18, 'ETH')}`,
        network: from,
        txHash: receipt.transactionHash,
    });
}

export type Transfer = {
    guid: Hex;
    from: Network;
    to: Network;
    wallet: WalletId | null;
    amountSent: bigint;
    amountReceived: bigint | null;
    sentTx: Hex;
    sentBlock: bigint;
    deliveredTx: Hex | null;
    status: 'in flight' | 'delivered';
};

// Every transfer since these forks started, rebuilt from OFTSent and matched to
// OFTReceived by guid, so nothing depends on the app having watched it happen.
export async function readTransfers(ctx: Ctx): Promise<Transfer[]> {
    const byAddress = new Map(
        WALLET_IDS.map((id) => [ctx.chains.address(id).toLowerCase(), id] as const),
    );
    const fromBlock = (network: Network) =>
        BigInt(getKv(ctx.db, `start_block:${network}`) ?? '0');
    const sentOn = (network: Network) =>
        ctx.chains.clients[network].getContractEvents({
            address: SIDES[network].oft.address,
            abi: oftAbi,
            eventName: 'OFTSent',
            fromBlock: fromBlock(network),
        });
    const receivedOn = (network: Network) =>
        ctx.chains.clients[network].getContractEvents({
            address: SIDES[network].oft.address,
            abi: oftAbi,
            eventName: 'OFTReceived',
            fromBlock: fromBlock(network),
        });
    const [sentArb, sentEth, recvArb, recvEth] = await Promise.all([
        sentOn('arbitrum'),
        sentOn('ethereum'),
        receivedOn('arbitrum'),
        receivedOn('ethereum'),
    ]);
    const received = new Map(
        [...recvArb, ...recvEth].map((log) => [log.args.guid!, log] as const),
    );
    const transfers: Transfer[] = [];

    for (const [from, sent] of [
        ['arbitrum', sentArb],
        ['ethereum', sentEth],
    ] as const) {
        for (const log of sent) {
            const delivery = received.get(log.args.guid!);

            transfers.push({
                guid: log.args.guid!,
                from,
                to: SIDES[from].other,
                wallet: byAddress.get(log.args.fromAddress!.toLowerCase()) ?? null,
                amountSent: log.args.amountSentLD!,
                amountReceived: delivery?.args.amountReceivedLD ?? null,
                sentTx: log.transactionHash,
                sentBlock: log.blockNumber,
                deliveredTx: delivery?.transactionHash ?? null,
                status: delivery ? 'delivered' : 'in flight',
            });
        }
    }

    // Newest first. Blocks on two chains do not compare, so in flight leads.
    return transfers.sort(
        (a, b) =>
            Number(a.status === 'delivered') - Number(b.status === 'delivered') ||
            Number(b.sentBlock - a.sentBlock),
    );
}
