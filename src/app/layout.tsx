import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EasyTranslator',
  description: '中英法三语研修班交流助手',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
