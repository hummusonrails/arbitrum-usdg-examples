import type { PaxosClient } from '@arbitrum-usdg/paxos-client';

// Sandbox only: simulates a bank wire carrying the rule's memo, which makes
// Paxos run the auto mint rule. The bank details are the Paxos sandbox
// quickstart values.
export async function simulateWire(paxos: PaxosClient, memoId: string, amount: string) {
    const bank = {
        country: 'USA',
        address1: '123 Bank Street',
        city: 'New York',
        province: 'NY',
        zip_code: '10101',
    };

    await paxos.initiateSandboxFiatDeposit({
        amount,
        asset: 'USD',
        memo_id: memoId,
        fiat_network_instructions: {
            wire: {
                account_number: '74600021314512',
                fiat_account_owner_address: { ...bank, address1: '456 Main Street' },
                routing_details: {
                    routing_number_type: 'ABA',
                    routing_number: '031302971',
                    bank_name: 'Customers Bank',
                    bank_address: bank,
                },
            },
        },
        fiat_account_owner: { institution_details: { name: 'Company' } },
    });
}

export const SANDBOX_BANK_ACCOUNT = {
    fiat_account_owner: { institution_details: { name: 'Company' } },
    fiat_network_instructions: {
        wire: {
            account_number: '74600021314512',
            fiat_account_owner_address: {
                country: 'USA',
                address1: '456 Main Street',
                city: 'New York',
                province: 'NY',
                zip_code: '10101',
            },
            routing_details: {
                routing_number_type: 'ABA' as const,
                routing_number: '031302971',
                bank_name: 'Customers Bank',
                bank_address: {
                    country: 'USA',
                    address1: '123 Bank Street',
                    city: 'New York',
                    province: 'NY',
                    zip_code: '10101',
                },
            },
        },
    },
};
