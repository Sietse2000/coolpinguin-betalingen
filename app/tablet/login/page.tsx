'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TabletLoginPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/tablet') }, [router])
  return null
}
