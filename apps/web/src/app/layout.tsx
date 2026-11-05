import type { Metadata } from 'next';
import { Fredoka, Inter, Noto_Sans_KR } from 'next/font/google';
import { Providers } from '@/lib/providers';
import './globals.css';

const fredoka = Fredoka({ subsets: ['latin'], variable: '--font-fredoka', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const noto = Noto_Sans_KR({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-noto-kr', display: 'swap', preload: false });

export const metadata: Metadata = { title: 'Texa Fashions OS', description: 'Omnichannel retail ERP demo for Texa Fashions' };

const themeScript = `try{var t=localStorage.getItem('uni-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${inter.variable} ${noto.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
