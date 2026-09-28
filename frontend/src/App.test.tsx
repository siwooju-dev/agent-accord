import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { mutationHeaders, setCsrf } from './api'

beforeEach(()=>{localStorage.clear();sessionStorage.clear()})
afterEach(()=>{cleanup();vi.restoreAllMocks()})

test('network retry retains the same idempotency key and changed body gets a new one',()=>{
  setCsrf('csrf')
  expect(mutationHeaders('approve',{hash:'a'})).toEqual(mutationHeaders('approve',{hash:'a'}))
  expect(mutationHeaders('approve',{hash:'b'})['Idempotency-Key']).not.toBe(mutationHeaders('approve',{hash:'a'})['Idempotency-Key'])
})

test('explicit mock disclosure and auth failures never display success',async()=>{
  vi.spyOn(globalThis,'fetch').mockImplementation(async(request)=>{
    const url = typeof request==='string'?request:(request as Request).url
    if(url.endsWith('/health'))return new Response(JSON.stringify({status:'ok',mode:'mock',contract_version:'2'}),{headers:{'Content-Type':'application/json'}})
    return new Response(JSON.stringify({error:{code:'SESSION_REQUIRED',message:'SESSION_REQUIRED'}}),{status:401,headers:{'Content-Type':'application/json'}})
  })
  render(<App/>)
  await waitFor(()=>expect(screen.getByText('모의 데모 시작')).toBeEnabled())
  expect(screen.getByText(/모의 에이전트·모의 체인/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('모의 데모 시작'))
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('SESSION_REQUIRED'))
  expect(screen.queryByText('모의 감사 기록 완료')).not.toBeInTheDocument()
})
