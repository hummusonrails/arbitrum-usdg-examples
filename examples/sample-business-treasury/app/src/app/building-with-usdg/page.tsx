import type { Metadata } from 'next';

import { BuildingView } from '@/components/BuildingView';

export const metadata: Metadata = { title: 'Building with USDG on Arbitrum' };

export default function Page() {
    return <BuildingView />;
}
