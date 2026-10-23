import type { SmsChallenge, SmsVerifyInput } from '../../../shared/providers.js'
import type { AstronApi, LoginResult } from './types.js'

/**
 * Dispatch an SMS code.
 *
 * The GeeTest triplet is solved by a human in the browser and arrives already validated; this
 * module never solves a captcha itself. It only forwards the triplet to the upstream send
 * endpoint.
 */
export function dispatchSmsCode(client: AstronApi, mobile: string, challenge: SmsChallenge): Promise<void> {
  return client.sendSmsCode(mobile, {
    challenge: challenge.geetest_challenge,
    validate: challenge.geetest_validate,
    seccode: challenge.geetest_seccode,
  })
}

/**
 * Complete an SMS login.
 *
 * `AstronClient.loginWithSms` owns the whole downstream chain — verify the code, `init-app`
 * (and flag a banned account), `userInfo` to fill in the uid/mobile/nickname, and
 * `bot/models/configs` for the model bearer token. This wrapper keeps that contract in one
 * place so the adapter only has to turn the result into an `AccountDraft`.
 */
export async function completeSmsLogin(client: AstronApi, input: SmsVerifyInput): Promise<LoginResult> {
  return client.loginWithSms(input.mobile, input.code)
}
