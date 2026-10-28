import type { Metadata } from 'next';

import { Console } from '@/components/console/Console';

export const metadata: Metadata = { title: 'Operator console' };

export default function Page() {
    return <Console />;
}
