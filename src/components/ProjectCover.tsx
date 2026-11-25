import { Building2 } from 'lucide-react'
import type { Project } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ProjectCover({ image, className }: { image?: Project['coverImage']; className?: string }) {
  return <div className={cn('project-cover', className)}>
    {image ? <img src={image} alt="" loading="lazy" decoding="async" />
      : <div className="project-cover-placeholder" aria-hidden="true"><Building2 className="size-9" strokeWidth={1.2} /></div>}
  </div>
}

export async function resizeProjectCover(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Choose a JPEG, PNG or WebP file under 12 MB.')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [.85, .72, .55]) {
      const result = canvas.toDataURL('image/webp', quality)
      if (result.length <= 450_000) return result
    }
    throw new Error('Try a smaller file for the project cover.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
