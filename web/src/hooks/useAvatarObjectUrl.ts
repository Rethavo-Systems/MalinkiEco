import { useEffect, useState } from 'react'
import { downloadUserAvatar } from '../lib/chatFilesApi'

const avatarUrlCache = new Map<string, string>()
const avatarUrlLoaders = new Map<string, Promise<string>>()
const MAX_AVATAR_LOAD_RETRIES = 2

export function useAvatarObjectUrl(downloadPath: string): string {
  const [loadedAvatar, setLoadedAvatar] = useState({ path: '', url: '' })
  const [retryAttempt, setRetryAttempt] = useState(0)
  const cachedUrl = downloadPath ? avatarUrlCache.get(downloadPath) : ''

  useEffect(() => {
    setRetryAttempt(0)
  }, [downloadPath])

  useEffect(() => {
    if (!downloadPath || avatarUrlCache.has(downloadPath)) return

    let disposed = false
    let retryTimer = 0
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
        if (!disposed && retryAttempt < MAX_AVATAR_LOAD_RETRIES) {
          retryTimer = window.setTimeout(() => {
            setRetryAttempt((current) => current + 1)
          }, 700 + retryAttempt * 900)
        }
      })

    return () => {
      disposed = true
      if (retryTimer) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [downloadPath, retryAttempt])

  if (!downloadPath) return ''
  if (cachedUrl) return cachedUrl
  return loadedAvatar.path === downloadPath ? loadedAvatar.url : ''
}
