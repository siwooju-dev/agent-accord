import { lazy, Suspense } from "react";

const LiveApp = lazy(() => import("./LiveApp"));

export default function LiveRoute() {
  return <Suspense fallback={<p role="status">실제 API 화면을 불러오는 중…</p>}>
    <LiveApp />
  </Suspense>;
}
