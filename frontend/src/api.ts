import createClient from 'openapi-fetch'
import type { paths, components } from './generated/api'
export type Deal = components['schemas']['DealView']
export type Policy = components['schemas']['BuyerPolicy']
export type Product = components['schemas']['ProductView']
export type Evidence = components['schemas']['EvidenceView']
export type Usage = components['schemas']['UsageSummary']
export const api = createClient<paths>({baseUrl:globalThis.location?.origin || 'http://localhost',credentials:'same-origin',fetch:(request)=>globalThis.fetch(request)})

let csrf = ''
export function setCsrf(value:string) { csrf = value }
export function mutationHeaders(scope:string, body:unknown) {
  // Retain the same key on network errors/reload; a changed payload gets a new key.
  const storageKey = 'dealbattle:idem:' + scope + ':' + JSON.stringify(body)
  let key = sessionStorage.getItem(storageKey)
  if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey,key) }
  return {'X-CSRF-Token':csrf,'Idempotency-Key':key}
}
export function acknowledgeMutation(scope:string,body:unknown) {
  sessionStorage.removeItem('dealbattle:idem:'+scope+':'+JSON.stringify(body))
}

export function result<T>(data:T|undefined, error:unknown):T {
  if (error) {
    const detail = error as {error?:{code?:string}}
    throw new Error(detail.error?.code || 'API 요청 실패')
  }
  if (!data) throw new Error('응답이 없습니다. 조회 후 다시 시도하세요.')
  return data
}
