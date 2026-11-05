import type { Metadata, Viewport } from 'next';
import { Fredoka, Inter, Noto_Sans_KR } from 'next/font/google';
import { Providers } from '@/lib/providers';
import './globals.css';

const fredoka = Fredoka({ subsets: ['latin'], variable: '--font-fredoka', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const noto = Noto_Sans_KR({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-noto-kr', display: 'swap', preload: false });

export const metadata: Metadata = { title: 'Texa Fashions POS', description: 'Offline-first tablet POS', manifest: '/manifest.webmanifest', icons: { icon: '/icon.svg' }, appleWebApp: { capable: true, title: 'Uni POS', statusBarStyle: 'default' } };
export const viewport: Viewport = { themeColor: '#E5486B', width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${fredoka.variable} ${inter.variable} ${noto.variable}`} suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
