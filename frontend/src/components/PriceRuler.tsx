export interface RulerRow {
  id: string;
  code: string;
  title: string;
  ask: number;
  offer: number;
  status: "pass" | "block";
  reason?: string;
}

const money = (n: number) => "₩" + new Intl.NumberFormat("ko-KR").format(n);
const compact = (n: number) => (n / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "만";

/**
 * Price convergence ruler: seller ask (gold) → agent offer (white), against the
 * buyer's private ceiling (blue). The ceiling line only exists in the buyer view.
 */
export function PriceRuler({
  rows,
  budget,
  selectedId,
  onSelect,
}: {
  rows: RulerRow[];
  budget: number | null;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const values = rows.flatMap((row) => [row.ask, row.offer]).concat(budget ? [budget] : []);
  const step = 50_000;
  const min = Math.floor((Math.min(...values) * 0.985) / step) * step;
  const max = Math.ceil((Math.max(...values) * 1.012) / step) * step;
  const pct = (value: number) => ((value - min) / (max - min)) * 100;
  const ticks: number[] = [];
  const tickStep = max - min > 300_000 ? 100_000 : 50_000;
  for (let v = Math.ceil(min / tickStep) * tickStep; v <= max; v += tickStep) ticks.push(v);

  return (
    <div className="ruler" style={{ ["--budget" as string]: budget ? `${pct(budget)}%` : "100%" }}>
      <div className="ruler-axis" aria-hidden="true">
        <span className="ruler-axis-name">매물 / 판매자</span>
        <span className="ruler-axis-track">
          {ticks.map((tick) => (
            <i key={tick} style={{ left: `${pct(tick)}%` }}>
              {compact(tick)}
            </i>
          ))}
        </span>
        <span className="ruler-axis-value">현재 총액</span>
      </div>
      <div className="ruler-body">
        <div className="ruler-overlay" aria-hidden="true">
          {budget ? (
            <>
              <span className="ruler-over" />
              <span className="ruler-budget">
                <b>내 한도 {money(budget)}</b>
                <small>비공개 · 상대 에이전트 미전달</small>
              </span>
            </>
          ) : (
            <span className="ruler-hidden-budget">구매자 한도 · 판매자 화면 비공개</span>
          )}
          {ticks.map((tick) => (
            <i key={tick} className="ruler-grid" style={{ left: `${pct(tick)}%` }} />
          ))}
        </div>
        {rows.map((row) => {
          const concession = row.ask - row.offer;
          return (
            <button
              key={row.id}
              type="button"
              className={"ruler-row " + row.status + (row.id === selectedId ? " is-selected" : "")}
              onClick={() => onSelect(row.id)}
              aria-pressed={row.id === selectedId}
            >
              <span className="ruler-name">
                <b>{row.code}</b>
                <small>{row.title}</small>
              </span>
              <span className="ruler-track">
                <i className="ruler-rail" />
                <i
                  className="ruler-span"
                  style={{ left: `${pct(Math.min(row.offer, row.ask))}%`, width: `${Math.abs(pct(row.ask) - pct(row.offer))}%` }}
                />
                <i className="ruler-ask" style={{ left: `${pct(row.ask)}%` }}>
                  <em>호가 {compact(row.ask)}</em>
                </i>
                <i className="ruler-offer" style={{ left: `${pct(row.offer)}%` }} />
              </span>
              <span className="ruler-value">
                <b>{money(row.offer)}</b>
                <small>
                  {concession > 0 ? `호가 대비 −${compact(concession)}` : "호가 유지"}
                  {row.status === "block" && row.reason ? ` · ${row.reason}` : ""}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="ruler-legend" aria-hidden="true">
        <span><i className="lg-ask" /> 판매자 호가 (배송비 포함)</span>
        <span><i className="lg-offer" /> 에이전트 현재 제안</span>
        {budget ? (
          <>
            <span><i className="lg-budget" /> 내 비공개 한도</span>
            <span><i className="lg-over" /> 한도 초과 구간</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
