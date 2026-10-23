export interface SseEvent {
  event: string
  data: string
  raw: string
}

/** Incremental SSE decoder that tolerates chunks split anywhere. */
export class SseDecoder {
  private buffer = ''

  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []
    for (;;) {
      const normalized = this.buffer.replace(/\r\n/gu, '\n')
      const index = normalized.indexOf('\n\n')
      if (index === -1) {
        this.buffer = normalized
        break
      }
      const block = normalized.slice(0, index)
      this.buffer = normalized.slice(index + 2)
      events.push(parseBlock(block))
    }
    return events
  }

  flush(): SseEvent[] {
    const block = this.buffer.trim()
    this.buffer = ''
    return block === '' ? [] : [parseBlock(block)]
  }
}

function parseBlock(block: string): SseEvent {
  let event = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  return { event, data: data.join('\n'), raw: `${block}\n\n` }
}

export function sseFrame(data: unknown, event?: string): string {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  return `${event === undefined ? '' : `event: ${event}\n`}data: ${body}\n\n`
}
