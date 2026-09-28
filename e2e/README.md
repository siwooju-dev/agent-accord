# Browser E2E

저장소 루트에서 `npm --prefix e2e ci`, `npm --prefix e2e exec -- playwright install chromium`, `npm --prefix e2e test`를 실행한다. Linux에서 브라우저 시스템 라이브러리가 없으면 `npm --prefix e2e exec -- playwright install --with-deps chromium`을 사용한다.

Python backend 의존성과 frontend npm 의존성이 먼저 설치되어야 한다. 기본 Python은 Windows `../.venv/Scripts/python.exe`, Linux `../.venv/bin/python`이다. 다른 인터프리터는 `DEALBATTLE_PYTHON`에 절대 경로로 설정한다. 테스트는 8000/5173 port에 별도 서버를 띄우며 이미 실행 중인 서버를 재사용하지 않는다. 서버는 임시 DB를 사용하므로 앱 DB를 초기화하지 않는다.

Windows 기존 Edge를 사용하는 검증:

```powershell
$env:E2E_BROWSER_CHANNEL = 'msedge'
npm --prefix e2e test
```

해당 브라우저는 독립된 headless 임시 프로필로 시작된다. 실제 Kiln/외부 testnet에 연결하지 않는다. 정상 협상·승인·새로고침, 예산 변경 차단, 판매자 제외 차단, 거절, 수정 후 재확정, 중복 클릭, 응답 유실 재시도를 검사한다. mock 기록은 실제 tx 링크를 만들지 않는다. 스크린샷은 `e2e/test-results/`에 출력되며 개인정보/토큰을 포함하지 않는 테스트 결과만 확인용으로 사용한다.
