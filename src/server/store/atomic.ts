import { randomBytes } from 'node:crypto'
import { open, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Write a file atomically: temp file, fsync, rename. */
export async function writeFileAtomic(path: string, content: string, mode = 0o600): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  await writeFile(temp, content, { mode })
  const handle = await open(temp, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temp, path)
}

/** Read JSON, returning undefined for a missing or malformed file. */
export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(path, 'utf8')
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** Ensure a directory exists with restrictive permissions. */
export async function ensureDir(path: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path, { recursive: true, mode: 0o700 })
  void dirname(path)
}
