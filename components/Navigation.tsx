'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/',              label: 'Dashboard',             icon: '▤' },
  { href: '/ritplanning',   label: 'Ritplanning',           icon: '🗺' },
  { href: '/upload',        label: 'Upload',                icon: '↑' },
  { href: '/review',        label: 'Handmatige controle',   icon: '⚑', highlight: true },
  { href: '/transactions',  label: 'Alle transacties',      icon: '≡' },
  { href: '/processed',     label: 'Verwerkt',              icon: '✓' },
  { href: '/invoices',      label: 'Facturen',              icon: '◈' },
  { href: '/rules',         label: 'Beslisregels',          icon: 'i' },
]

export default function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="fixed left-0 top-0 h-full w-60 flex flex-col" style={{ backgroundColor: '#2c80b3' }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐧</span>
          <div>
            <div className="text-white font-medium text-base leading-tight">Coolpinguin</div>
            <div className="text-white/60 text-xs">Betalingen</div>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="flex-1 py-3 overflow-y-auto">
        {links.map((link) => {
          const active = pathname === link.href
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-cp-dark text-white font-medium'
                  : link.highlight
                  ? 'text-white/90 hover:bg-white/20 font-medium'
                  : 'text-white/80 hover:bg-white/15'
              }`}
            >
              <span className="w-5 text-center text-sm">{link.icon}</span>
              <span>{link.label}</span>
              {link.highlight && !active && (
                <span className="ml-auto w-2 h-2 rounded-full bg-amber-400" />
              )}
            </Link>
          )
        })}
      </div>

      <div className="px-4 py-3 border-t border-white/20 text-xs text-white/40">
        v0.1.0 – Fase 1
      </div>
    </nav>
  )
}
