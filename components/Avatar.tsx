'use client'

import { useState } from 'react'

export default function Avatar() {
  const [error, setError] = useState(false)

  return (
    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-200 shrink-0 flex items-center justify-center">
      {error ? (
        <span className="text-gray-400 text-lg">👤</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/avatar.jpg"
          alt="Profiel"
          className="object-cover w-full h-full"
          onError={() => setError(true)}
        />
      )}
    </div>
  )
}
