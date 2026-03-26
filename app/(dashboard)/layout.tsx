import Navigation from '@/components/Navigation'
import Avatar from '@/components/Avatar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />
      <div className="flex-1 ml-60 flex flex-col max-w-[calc(100vw-240px)]">
        {/* Top bar met profielfoto */}
        <div className="flex justify-end items-center px-6 py-3">
          <Avatar />
        </div>
        <main className="flex-1 px-6 pb-6">
          {children}
        </main>
      </div>
    </div>
  )
}
