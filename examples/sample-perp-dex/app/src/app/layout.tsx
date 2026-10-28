import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { DemoStrip } from '@/components/DemoStrip';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
    title: 'Acme Perps',
    description:
        'A sample perp DEX that takes USDG as margin, registers its margin vault for USDG rewards through propose and accept, and shares them with traders.',
    icons: { icon: '/acme-perps.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" className={`${inter.variable} ${mono.variable}`}>
            <body className="font-sans antialiased">
                <div className="stage-lights" aria-hidden />
                <div className="flex min-h-dvh flex-col md:flex-row">
                    <Sidebar />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <DemoStrip />
                        <Header />
                        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
                            {children}
                        </main>
                        <Footer />
                    </div>
                </div>
            </body>
        </html>
    );
}
