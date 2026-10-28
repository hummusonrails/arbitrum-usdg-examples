// Stands in for Paxos onboarding. A real partner gets a payout group from Paxos
// (the Dashboard, or POST /v2/rewards/payout-groups), and Paxos creates it on
// chain. On the fork, this impersonates the Paxos registrar to do the same.
import { PAYOUT_GROUP_REGISTRAR, USDG, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { parseEventLogs, type Address } from 'viem';

import { asAccount, type ForkClient } from './anvil.ts';

export async function createPayoutGroup(
    client: ForkClient,
    roles: {
        claimer: Address;
        manager: Address;
        destination: Address;
        multiplierId?: number;
    },
): Promise<number> {
    return asAccount(client, PAYOUT_GROUP_REGISTRAR, async () => {
        const hash = await client.writeContract({
            account: PAYOUT_GROUP_REGISTRAR,
            chain: client.chain,
            address: USDG.arbitrumOne.address,
            abi: usdgRewardsAbi,
            functionName: 'createPayoutGroupWithRoles',
            args: [
                roles.multiplierId ?? 1,
                roles.claimer,
                roles.manager,
                roles.destination,
            ],
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        const [created] = parseEventLogs({
            abi: usdgRewardsAbi,
            eventName: 'PayoutGroupCreated',
            logs: receipt.logs,
        });

        if (!created) {
            throw new Error(
                'Creating the payout group emitted no PayoutGroupCreated event',
            );
        }

        return created.args.payoutGroupId;
    });
}
