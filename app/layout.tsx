import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FieldScreen TV — Preview',
  icons: { icon: '/images/fieldscreen-mark.png' },
  description: 'A TV-first NFL control room with a field wall and configurable multiview. Interactive design preview.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
