import type { LoginGeetest } from '../../shared/types.js'

interface GeetestValidate {
  geetest_challenge: string
  geetest_validate: string
  geetest_seccode: string
}

interface GeetestInstance {
  onReady: (callback: () => void) => void
  onSuccess: (callback: () => void) => void
  onError: (callback: () => void) => void
  onClose?: (callback: () => void) => void
  verify: () => void
  getValidate: () => GeetestValidate | undefined
  destroy?: () => void
}

declare global {
  interface Window {
    initGeetest?: (config: Record<string, unknown>, callback: (instance: GeetestInstance) => void) => void
  }
}

const SDK_URL = 'https://static.geetest.com/static/tools/gt.js'
let loading: Promise<void> | undefined

function loadSdk(): Promise<void> {
  if (typeof window.initGeetest === 'function') return Promise.resolve()
  if (loading !== undefined) return loading
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.dataset['myapiGeetest'] = 'true'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => {
      script.remove()
      loading = undefined
      reject(new Error('安全验证脚本加载失败，请检查网络（需要能访问 static.geetest.com）'))
    }, { once: true })
    document.head.appendChild(script)
  })
  return loading
}

/** Load GeeTest v3 and resolve the browser-solved captcha payload. */
export async function solveGeetest(config: LoginGeetest): Promise<GeetestValidate> {
  await loadSdk()
  if (typeof window.initGeetest !== 'function') throw new Error('安全验证组件不可用，请刷新页面重试')
  return new Promise<GeetestValidate>((resolve, reject) => {
    let settled = false
    let instance: GeetestInstance | undefined
    const finish = (result: { value?: GeetestValidate; error?: Error }): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        instance?.destroy?.()
      } catch {
        // The widget may already be gone.
      }
      if (result.value !== undefined) resolve(result.value)
      else reject(result.error ?? new Error('安全验证失败'))
    }
    const timer = window.setTimeout(() => finish({ error: new Error('安全验证超时，请重试') }), 60_000)
    window.initGeetest?.({
      gt: config.gt,
      challenge: config.challenge,
      success: config.success,
      new_captcha: config.new_captcha,
      https: true,
      offline: !config.success,
      product: 'bind',
      width: '100%',
    }, created => {
      instance = created
      created.onReady(() => {
        try {
          created.verify()
        } catch {
          finish({ error: new Error('安全验证启动失败，请重试') })
        }
      })
      created.onError(() => finish({ error: new Error('安全验证异常，请重试') }))
      created.onClose?.(() => finish({ error: new Error('安全验证已取消') }))
      created.onSuccess(() => {
        const value = created.getValidate()
        if (value === undefined) {
          finish({ error: new Error('安全验证结果无效，请重试') })
          return
        }
        finish({ value })
      })
    })
  })
}
