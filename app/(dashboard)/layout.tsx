import Navigation from '@/components/Navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />
      <main className="flex-1 ml-60 p-6 max-w-[calc(100vw-240px)]">
        {children}
      </main>
    </div>
  )
}
