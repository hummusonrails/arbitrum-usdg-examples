import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { DemoStrip } from '@/components/DemoStrip';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
    title: 'Acme Co. Treasury',
    description:
        'A sample business treasury app built with USDG and the Paxos APIs on Arbitrum.',
    icons: { icon: '/acme-icon.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" className={`${inter.variable} ${mono.variable}`}>
            <body className="font-sans antialiased">
                <div className="stage-lights" aria-hidden />
                <div className="flex min-h-dvh flex-col md:flex-row">
                    <Sidebar />
                    <div className="min-w-0 flex-1">
                        <DemoStrip />
                        <Header />
                        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
                    </div>
                </div>
            </body>
        </html>
    );
}
