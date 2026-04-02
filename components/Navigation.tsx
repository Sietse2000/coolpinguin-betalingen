'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

const sections = [
  {
    label: 'Planning',
    links: [
      { href: '/ritplanning', label: 'Ritplanning', icon: '🗺' },
    ],
  },
  {
    label: 'Betalingen',
    links: [
      { href: '/',             label: 'Dashboard',           icon: '▤' },
      { href: '/upload',       label: 'Upload',              icon: '↑' },
      { href: '/review',       label: 'Handmatige controle', icon: '⚑', highlight: true },
      { href: '/transactions', label: 'Alle transacties',    icon: '≡' },
      { href: '/processed',    label: 'Verwerkt',            icon: '✓' },
      { href: '/invoices',     label: 'Facturen',            icon: '◈' },
      { href: '/debiteuren',   label: 'Debiteuren',          icon: '€' },
      { href: '/rules',        label: 'Beslisregels',        icon: 'i' },
    ],
  },
]

export default function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="fixed left-0 top-0 h-full w-60 flex flex-col" style={{ backgroundColor: '#083046' }}>
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/20 flex items-center gap-3">
        <Image
          src="/penguin.png"
          alt="Coolpinguin"
          width={36}
          height={36}
          style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
        />
        <Image
          src="/Coolpinguin Logo wit rental & sales.png"
          alt="Coolpinguin"
          width={130}
          height={50}
          style={{ objectFit: 'contain', objectPosition: 'left' }}
        />
      </div>

      {/* Gesectionneerde links */}
      <div className="flex-1 py-3 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label} className="mb-2">
            <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
              {section.label}
            </div>
            {section.links.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    active
                      ? 'bg-cp-dark text-white font-medium'
                      : 'highlight' in link && link.highlight
                      ? 'text-white/90 hover:bg-white/20 font-medium'
                      : 'text-white/80 hover:bg-white/15'
                  }`}
                >
                  <span className="w-5 text-center text-sm">{link.icon}</span>
                  <span>{link.label}</span>
                  {'highlight' in link && link.highlight && !active && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-amber-400" />
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-white/20 text-xs text-white/40">
        v0.1.0
      </div>
    </nav>
  )
}
