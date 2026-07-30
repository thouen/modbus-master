import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: 'Modbus Master Station',
  description: 'Industrial Modbus TCP Master Station - Monitor and control PLC devices',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" className="dark">
      <body className={`antialiased bg-background text-foreground`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
