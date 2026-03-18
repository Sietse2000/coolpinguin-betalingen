import type { Metadata } from 'next'
import { Ubuntu } from 'next/font/google'
import './globals.css'

const ubuntu = Ubuntu({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-ubuntu',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Coolpinguin – Betalingen',
  description: 'Coolpinguin – Bankbetalingen matchen aan openstaande facturen in RentMagic',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={ubuntu.variable}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
