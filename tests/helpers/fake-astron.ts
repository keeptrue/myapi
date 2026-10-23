import type {
  AstronApi,
  AstronSession,
  BetaEligibility,
  CatalogModel,
  GeetestCaptcha,
  GeetestConfig,
  LoginResult,
  Membership,
  ModelConfig,
  PointsBalance,
  Popup,
  RedeemResult,
  TenantApp,
  UserInfo,
} from '../../src/server/astron/types.js'

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

export class FakeAstron implements AstronApi {
  catalog: CatalogModel[] = [
    {
      slug: 'xopglm52',
      name: 'GLM-5.2',
      description: 'test model',
      contextWindow: 1_000_000,
      maxOutputTokens: 8192,
      priority: 10,
      visibility: 'list',
      supportedInApi: true,
      inputModalities: ['text'],
      reasoningEfforts: ['low', 'high', 'max'],
      defaultReasoning: 'high',
      canDisableThinking: true,
    },
    {
      slug: 'spark-x2.5',
      name: 'Spark-X2.5',
      description: 'test model',
      contextWindow: 262144,
      maxOutputTokens: 100000,
      priority: 5,
      visibility: 'list',
      supportedInApi: true,
      inputModalities: ['text'],
      reasoningEfforts: ['high'],
      defaultReasoning: 'high',
      canDisableThinking: true,
    },
  ]

  configs: ModelConfig[] = [
    {
      id: 'lm_glm52',
      name: 'GLM-5.2',
      model: 'xopglm52',
      provider: 'astron',
      baseUrl: 'https://upstream.test/v1',
      apiKey: 'bearer-1',
      pointMultiplier: '1',
      isDefault: true,
      isCurrent: true,
    },
  ]

  nextAccountId = 'account-1'
  nextBearer = 'bearer-1'
  points = 1000
  spark = 1000
  chatHandler: (body: unknown) => Response = body => json({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: (body as { model?: string }).model ?? 'xopglm52',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hello from fake' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  })

  inferenceCalls: Array<{ path: string; session: AstronSession; body: unknown }> = []
  geetestCalls = 0
  smsCalls = 0
  loginCalls = 0
  refreshCalls = 0

  async fetchGeetest(): Promise<GeetestConfig> {
    this.geetestCalls += 1
    return { gt: 'gt-test', challenge: 'challenge-test', success: true, new_captcha: true }
  }

  async sendSmsCode(_mobile: string, _captcha: GeetestCaptcha): Promise<void> {
    this.smsCalls += 1
  }

  async loginWithSms(mobile: string, _code: string): Promise<LoginResult> {
    this.loginCalls += 1
    return {
      accountId: this.nextAccountId,
      uid: 'uid-1',
      token: 'login-token',
      ssoSessionId: 'login-sso',
      mobile,
      nickname: '登录账号',
      avatar: '',
      isNew: false,
      banned: false,
      modelBearerToken: this.nextBearer,
    }
  }

  async fetchUserInfo(session: AstronSession): Promise<UserInfo> {
    return { uid: session.uid || 'uid-1', mobile: '13800138000', nickname: '测试账号', avatar: '' }
  }

  async initTenantApp(_session: AstronSession): Promise<TenantApp> {
    return { banned: false }
  }

  async fetchModelConfigs(session: AstronSession): Promise<{ configs: ModelConfig[]; bearer: string }> {
    this.refreshCalls += 1
    const bearer = session.modelBearerToken === '' ? this.nextBearer : session.modelBearerToken
    return {
      configs: this.configs.map(config => ({ ...config, apiKey: bearer })),
      bearer,
    }
  }

  async fetchCatalog(_bearer: string): Promise<CatalogModel[]> {
    return this.catalog
  }

  async pointsBalance(_session: AstronSession): Promise<PointsBalance> {
    return {
      totalAmount: this.points,
      totalBalance: this.points,
      memberBalance: 0,
      buyBalance: 0,
      activityBalance: 0,
      sparkTotalAmount: this.spark,
      sparkTotalBalance: this.spark,
      activityNextExpireTime: '',
      buyNextExpireTime: '',
    }
  }

  async membership(_session: AstronSession): Promise<Membership> {
    return { uid: '1', active: true, planCode: 'trial', planName: '体验版', endTime: '', autoRenew: false }
  }

  async pendingPopups(_session: AstronSession): Promise<Popup[]> {
    return []
  }

  async completePopup(_session: AstronSession, _popupId: number, _instanceKey: string): Promise<void> {}

  async claimDownloadReward(_session: AstronSession): Promise<void> {}

  async betaEligibility(_session: AstronSession): Promise<BetaEligibility> {
    return { canClaim: false, alreadyClaimed: true, reason: '' }
  }

  async claimBeta(_session: AstronSession, _domainAccount: string): Promise<void> {}

  async redeemCode(_session: AstronSession, _code: string): Promise<RedeemResult> {
    return { points: 100, expireTime: '' }
  }

  async inference(path: string, session: AstronSession, body: unknown, _signal: AbortSignal): Promise<Response> {
    this.inferenceCalls.push({ path, session, body })
    return this.chatHandler(body)
  }
}

export { json, sse }
