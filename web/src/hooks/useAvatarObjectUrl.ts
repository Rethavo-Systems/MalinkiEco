import { useEffect, useState } from 'react'
import { downloadUserAvatar } from '../lib/chatFilesApi'

const avatarUrlCache = new Map<string, string>()
const avatarUrlLoaders = new Map<string, Promise<string>>()

export function useAvatarObjectUrl(downloadPath: string): string {
  const [loadedAvatar, setLoadedAvatar] = useState({ path: '', url: '' })
  const cachedUrl = downloadPath ? avatarUrlCache.get(downloadPath) : ''

  useEffect(() => {
    if (!downloadPath || avatarUrlCache.has(downloadPath)) return

    let disposed = false
    let loader = avatarUrlLoaders.get(downloadPath)
    if (!loader) {
      loader = downloadUserAvatar(downloadPath).then((blob) => {
        const nextUrl = URL.createObjectURL(blob)
        avatarUrlCache.set(downloadPath, nextUrl)
        avatarUrlLoaders.delete(downloadPath)
        return nextUrl
      })
      avatarUrlLoaders.set(downloadPath, loader)
    }

    loader
      .then((nextUrl) => {
        if (disposed) return
        setLoadedAvatar({ path: downloadPath, url: nextUrl })
      })
      .catch(() => {
        avatarUrlLoaders.delete(downloadPath)
      })

    return () => {
      disposed = true
    }
  }, [downloadPath])

  if (!downloadPath) return ''
  if (cachedUrl) return cachedUrl
  return loadedAvatar.path === downloadPath ? loadedAvatar.url : ''
}
