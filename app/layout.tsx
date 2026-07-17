import './globals.css';
import { Providers } from './Providers';

export const metadata = {
  title: 'PayNode',
  description: 'One Link. Get Paid Securely.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}