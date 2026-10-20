'use client';

import { ActionBar } from './ActionBar';
import { Overview } from './Overview';
import { useSnapshot } from './useSnapshot';

export function OverviewPage() {
    const s = useSnapshot();

    return <Overview actions={s ? <ActionBar mode={s.mode} /> : null} />;
}
