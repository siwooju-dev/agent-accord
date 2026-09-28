import { test, expect } from '@playwright/test'

async function begin(page:any,budget=1000000,seller='seller-a') {
  await page.goto('/')
  await page.getByRole('button',{name:'모의 데모 시작'}).click()
  await page.getByLabel('최대 총예산').fill(String(budget))
  await page.getByLabel('허용 판매자 ID').fill(seller)
  await page.getByRole('button',{name:'딜 생성',exact:true}).click()
  await page.getByRole('button',{name:'표시된 조건 확정'}).click()
  await page.getByRole('button',{name:'Buyer / Seller 협상 시작'}).click()
}

test('A: condition, agent timeline, explicit approval, mock receipt, reload',async({page})=>{
  await begin(page)
  await expect(page.getByText('Buyer Agent · 제안 1')).toBeVisible()
  await expect(page.getByText('Seller Agent · 제안 2')).toBeVisible()
  await expect(page.getByRole('button',{name:'합의 승인 및 감사 기록'})).toBeDisabled()
  await page.getByLabel('총액·판매자·배송일을 확인했고').check()
  await page.getByRole('button',{name:'합의 승인 및 감사 기록'}).click()
  await expect(page.getByText('모의 감사 기록 완료',{exact:true})).toBeVisible()
  await expect(page.getByText('결제 영수증이 아닙니다.')).toBeVisible()
  await expect(page.getByRole('link',{name:'트랜잭션 조회'})).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('모의 감사 기록 완료',{exact:true})).toBeVisible()
  await page.screenshot({path:'test-results/dealbattle-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'test-results/dealbattle-mobile.png',fullPage:true})
})

test('B: lower budget has zero calls and no approval button',async({page})=>{
  await begin(page,900000)
  await expect(page.getByText('BLOCK · BUDGET_EXCEEDED')).toBeVisible()
  await expect(page.getByText(/호출 0회/)).toBeVisible()
  await expect(page.getByRole('button',{name:'합의 승인 및 감사 기록'})).toHaveCount(0)
})

test('C: excluded seller blocked before model calls',async({page})=>{
  await begin(page,1000000,'seller-b')
  await expect(page.getByText('BLOCK · SELLER_NOT_ALLOWED')).toBeVisible()
  await expect(page.getByText(/호출 0회/)).toBeVisible()
})

test('reject invalidates agreement and cannot submit chain',async({page})=>{
  await begin(page)
  await page.getByRole('button',{name:'거절',exact:true}).click()
  await expect(page.getByText('거절됨',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'합의 승인 및 감사 기록'})).toHaveCount(0)
})

test('policy editing invalidates agreement and forces confirmation',async({page})=>{
  await begin(page)
  await page.getByLabel('총액·판매자·배송일을 확인했고').check()
  await page.getByLabel('최대 총예산').fill('900000')
  await expect(page.getByRole('button',{name:'합의 승인 및 감사 기록'})).toBeDisabled()
  await page.getByRole('button',{name:'조건 변경 저장'}).click()
  await expect(page.getByRole('button',{name:'합의 승인 및 감사 기록'})).toHaveCount(0)
  await page.getByRole('button',{name:'표시된 조건 확정'}).click()
  await page.getByRole('button',{name:'Buyer / Seller 협상 시작'}).click()
  await expect(page.getByText('BLOCK · BUDGET_EXCEEDED')).toBeVisible()
  await page.reload()
  await expect(page.getByText('BLOCK · BUDGET_EXCEEDED')).toBeVisible()
})

test('approval response loss reuses the same idempotency key',async({page})=>{
  await begin(page)
  const keys:string[]=[]
  await page.route('**/agreement/approve',async route=>{
    keys.push(route.request().headers()['idempotency-key'])
    if(keys.length===1) await route.abort('failed')
    else await route.continue()
  })
  await page.getByLabel('총액·판매자·배송일을 확인했고').check()
  await page.getByRole('button',{name:'합의 승인 및 감사 기록'}).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button',{name:'합의 승인 및 감사 기록'}).click()
  await expect(page.getByText('모의 감사 기록 완료',{exact:true})).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
})
