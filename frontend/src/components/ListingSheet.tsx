import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { DEMO_EVIDENCE, DEMO_LISTINGS } from "../data/demo";
import {
  EVIDENCE_VIEWS,
  LISTING_PHOTOS,
  PAPER_TEXTURE,
  type Credit,
  type Photo,
  type ReceiptMedia,
  type SerialMedia,
  type Tone,
  type VideoMedia,
  type WarrantyMedia,
} from "../data/media";
import type { Evidence } from "../types";
import { Icon, type IconName } from "./Icon";
import { Img } from "./Img";
import "./ListingSheet.css";

export const EVIDENCE_TONE: Record<Evidence["status"], Tone> = {
  checked: "pass",
  seller_claimed: "warn",
  conflicted: "block",
  unknown: "idle",
};
export const EVIDENCE_STATUS_LABEL: Record<Evidence["status"], string> = {
  checked: "확인됨",
  seller_claimed: "판매자 주장",
  conflicted: "서로 다름",
  unknown: "확인 보류",
};
export const EVIDENCE_ICON: Record<Evidence["kind"], IconName> = {
  video: "video",
  receipt: "receipt",
  serial: "serial",
  warranty: "warranty",
};
const SHORT_LABEL: Record<Evidence["kind"], string> = {
  video: "작동 영상",
  receipt: "영수증",
  serial: "시리얼",
  warranty: "보증 조회",
};

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const won = (n: number) => "₩" + new Intl.NumberFormat("ko-KR").format(n);
const rtf = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
function relative(iso: string, now: number) {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
const absolute = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

/* ───────── chips used on cards ───────── */

export function EvidenceChip({ evidence, onOpen, compact = false }: { evidence: Evidence; onOpen: () => void; compact?: boolean }) {
  const tone = EVIDENCE_TONE[evidence.status];
  const view = EVIDENCE_VIEWS[evidence.id];
  const extra = view?.media.type === "video" ? ` ${clock(view.media.duration)}` : "";
  return (
    <button
      type="button"
      className={"ev-chip tone-" + tone + (compact ? " compact" : "")}
      onClick={onOpen}
      title={`${evidence.label} · ${EVIDENCE_STATUS_LABEL[evidence.status]}`}
    >
      <Icon name={EVIDENCE_ICON[evidence.kind]} size={13} />
      <span>
        {SHORT_LABEL[evidence.kind]}
        {extra && <em>{extra}</em>}
      </span>
      <i className="ev-chip-state" aria-label={EVIDENCE_STATUS_LABEL[evidence.status]}>
        <Icon name={tone} size={12} />
      </i>
    </button>
  );
}

export function EvidenceStatus({ status }: { status: Evidence["status"] }) {
  const tone = EVIDENCE_TONE[status];
  return (
    <span className={"pill small tone-" + tone}>
      <Icon name={tone} size={12} />
      {EVIDENCE_STATUS_LABEL[status]}
    </span>
  );
}

/* ───────── the sheet ───────── */

type Item = { kind: "photo"; id: string; photo: Photo } | { kind: "evidence"; id: string; evidence: Evidence };

export function listingItems(listingId: string): Item[] {
  const listing = DEMO_LISTINGS.find((entry) => entry.id === listingId);
  const photos: Item[] = (LISTING_PHOTOS[listingId] ?? []).map((photo) => ({ kind: "photo", id: photo.id, photo }));
  const evidence: Item[] = DEMO_EVIDENCE.filter((entry) => listing?.evidenceIds.includes(entry.id)).map((entry) => ({
    kind: "evidence",
    id: entry.id,
    evidence: entry,
  }));
  return [...evidence, ...photos];
}

export function ListingSheet({
  listingId,
  itemId,
  onSelect,
  onClose,
  priceKrw,
  now,
}: {
  listingId: string;
  itemId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  priceKrw?: number;
  now: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const listing = DEMO_LISTINGS.find((entry) => entry.id === listingId);
  const items = useMemo(() => listingItems(listingId), [listingId]);
  const index = Math.max(0, items.findIndex((item) => item.id === itemId));
  const item = items[index];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Focus the sheet itself so no control shows a focus ring until the viewer uses the keyboard.
    dialog?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT") return;
      if (event.key === "ArrowRight") onSelect(items[(index + 1) % items.length].id);
      if (event.key === "ArrowLeft") onSelect(items[(index - 1 + items.length) % items.length].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items, onSelect]);

  if (!listing || !item) return null;
  const evidenceCount = items.filter((entry) => entry.kind === "evidence").length;
  const photoCount = items.length - evidenceCount;
  const view = item.kind === "evidence" ? EVIDENCE_VIEWS[item.id] : undefined;

  const seek = (at: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = at;
    void video.play().catch(() => undefined);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      tabIndex={-1}
      aria-labelledby="sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="sheet-inner">
        <section className="sheet-media">
          <header className="sheet-head">
            <div>
              <p className="sheet-kicker">
                {listing.sellerName} · 증빙 {evidenceCount} · 사진 {photoCount}
              </p>
              <h2 id="sheet-title">{listing.model}</h2>
            </div>
            {priceKrw !== undefined && <b className="sheet-price">{won(priceKrw)}</b>}
          </header>

          <div className="sheet-stage" key={item.id}>
            {item.kind === "photo" && <PhotoStage photo={item.photo} />}
            {view?.media.type === "video" && <VideoStage media={view.media} videoRef={videoRef} />}
            {view?.media.type === "serial" && <SerialStage media={view.media} />}
            {view?.media.type === "receipt" && <ReceiptStage media={view.media} />}
            {view?.media.type === "warranty" && <WarrantyStage media={view.media} />}
            <button className="stage-nav prev" type="button" onClick={() => onSelect(items[(index - 1 + items.length) % items.length].id)} aria-label="이전 항목">
              <Icon name="prev" size={18} />
            </button>
            <button className="stage-nav next" type="button" onClick={() => onSelect(items[(index + 1) % items.length].id)} aria-label="다음 항목">
              <Icon name="next" size={18} />
            </button>
          </div>

          <ol className="rail" aria-label="증빙과 사진">
            {items.map((entry, position) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={"rail-item" + (entry.id === item.id ? " is-on" : "")}
                  onClick={() => onSelect(entry.id)}
                  aria-current={entry.id === item.id ? "true" : undefined}
                  aria-label={`${position + 1}. ${entry.kind === "photo" ? entry.photo.caption : entry.evidence.label}`}
                >
                  <RailThumb entry={entry} />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <aside className="sheet-side">
          <div className="side-top">
            <span className="side-count">
              {index + 1} / {items.length}
              <span className="kbd-hint" aria-hidden="true">
                <kbd>←</kbd>
                <kbd>→</kbd> 이동 · <kbd>Esc</kbd> 닫기
              </span>
            </span>
            <button className="sheet-close" type="button" onClick={onClose} aria-label="닫기 (Esc)">
              <Icon name="close" size={18} />
            </button>
          </div>

          {item.kind === "photo" ? (
            <>
              <p className="side-eyebrow">
                <Icon name="camera" size={14} /> 매물 사진
              </p>
              <h3 className="side-title">{item.photo.caption}</h3>
              <p className="side-summary">{item.photo.alt}</p>
              <p className="side-hint">판매자가 올린 사진이에요. 사진만으로는 작동 여부나 진품 여부를 판단하지 않아요.</p>
              <CreditLine credit={item.photo.credit} />
            </>
          ) : (
            view && (
              <>
                <p className="side-eyebrow">
                  <Icon name={EVIDENCE_ICON[item.evidence.kind]} size={14} /> 증빙
                </p>
                <h3 className="side-title">
                  {item.evidence.label} <EvidenceStatus status={item.evidence.status} />
                </h3>
                <p className="side-summary">{view.summary}</p>

                <h4 className="side-sub">AI 검토 메모</h4>
                <ul className="findings">
                  {view.findings.map((finding) => (
                    <li key={finding.text} className={"tone-" + finding.tone}>
                      <Icon name={finding.tone} size={15} />
                      <span>{finding.text}</span>
                      {finding.at !== undefined && (
                        <button type="button" className="at" onClick={() => seek(finding.at!)} aria-label={`${clock(finding.at)} 지점부터 보기`}>
                          {clock(finding.at)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="side-hint">AI 메모는 참고용이에요. 거래 가능 여부는 서버 규칙이 정하고, 승인은 사람이 해요.</p>

                <dl className="side-meta">
                  <div>
                    <dt>올린 사람</dt>
                    <dd>{view.uploader}</dd>
                  </div>
                  <div>
                    <dt>올린 시각</dt>
                    <dd title={absolute(view.uploadedAt)}>
                      {relative(view.uploadedAt, now)} <span className="muted">· {absolute(view.uploadedAt)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>파일</dt>
                    <dd>{view.file}</dd>
                  </div>
                  <div>
                    <dt>해시</dt>
                    <dd className="mono">{item.evidence.hash}</dd>
                  </div>
                </dl>
                {view.media.type === "video" && <CreditLine credit={view.media.credit} />}
                {view.media.type === "serial" && <CreditLine credit={view.media.photo.credit} />}
                {(view.media.type === "receipt" || view.media.type === "warranty") && (
                  <p className="credit">견본 문서 · 가상의 상점·주문 정보로 만든 데모 화면이에요.</p>
                )}
              </>
            )
          )}
        </aside>
      </div>
    </dialog>
  );
}

function CreditLine({ credit }: { credit: Credit }) {
  return (
    <p className="credit">
      {credit.license === "CC0" ? "자료" : "사진·영상"}{" "}
      <a href={credit.url} target="_blank" rel="noreferrer">
        {credit.author} <Icon name="external" size={11} />
      </a>{" "}
      · {credit.license}
      {credit.edited ? ` · ${credit.edited}` : ""}
    </p>
  );
}

function RailThumb({ entry }: { entry: Item }) {
  if (entry.kind === "photo") {
    return (
      <span className="thumb">
        <img src={entry.photo.src} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  const view = EVIDENCE_VIEWS[entry.id];
  const tone = EVIDENCE_TONE[entry.evidence.status];
  const media = view?.media;
  return (
    <span className={"thumb ev tone-" + tone}>
      {media?.type === "video" && <img src={media.poster} alt="" loading="lazy" decoding="async" />}
      {media?.type === "serial" && <img src={media.photo.src} alt="" loading="lazy" decoding="async" />}
      {(media?.type === "receipt" || media?.type === "warranty") && (
        <span className="thumb-doc">
          <Icon name={EVIDENCE_ICON[entry.evidence.kind]} size={20} />
        </span>
      )}
      {media?.type === "video" && (
        <span className="thumb-play">
          <Icon name="play" size={10} /> {clock(media.duration)}
        </span>
      )}
      <span className="thumb-state">
        <Icon name={tone} size={12} />
      </span>
    </span>
  );
}

/* ───────── stages ───────── */

function PhotoStage({ photo }: { photo: Photo }) {
  return (
    <figure className="stage-photo">
      <Img src={photo.src} alt={photo.alt} width={photo.w} height={photo.h} fit="contain" />
    </figure>
  );
}

function VideoStage({ media, videoRef }: { media: VideoMedia; videoRef: RefObject<HTMLVideoElement | null> }) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) void video.play().catch(() => undefined);
  }, [media.src, videoRef]);
  const chapter = [...media.chapters].reverse().find((entry) => time >= entry.at) ?? media.chapters[0];
  const readout = media.readout?.filter((entry) => time >= entry.from) ?? [];
  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };
  return (
    <div className="stage-video">
      <video
        ref={videoRef}
        poster={media.poster}
        muted
        loop
        playsInline
        preload="metadata"
        onClick={toggle}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={media.src} type="video/mp4" />
        <source src={media.webm} type="video/webm" />
      </video>
      <span className="video-chapter">
        <i /> {chapter.label}
      </span>
      {readout.length > 0 && (
        <span className="video-readout" aria-live="polite">
          {readout.map((entry) => (
            <span key={entry.label}>
              <small>{entry.label}</small>
              <b>{entry.value}</b>
            </span>
          ))}
        </span>
      )}
      <div className="video-bar">
        <button type="button" className="video-toggle" onClick={toggle} aria-label={playing ? "일시정지" : "재생"}>
          <Icon name={playing ? "pause" : "play"} size={15} />
        </button>
        <div className="video-scrub">
          <input
            type="range"
            min={0}
            max={media.duration}
            step={0.1}
            value={Math.min(time, media.duration)}
            aria-label="재생 위치"
            style={{ "--p": `${(Math.min(time, media.duration) / media.duration) * 100}%` } as CSSProperties}
            onChange={(event) => {
              const video = videoRef.current;
              if (video) video.currentTime = Number(event.currentTarget.value);
            }}
          />
          {media.chapters.slice(1).map((entry) => (
            <i key={entry.at} className="video-tick" style={{ left: `${(entry.at / media.duration) * 100}%` }} title={entry.label} />
          ))}
        </div>
        <span className="video-time">
          {clock(time)} / {clock(media.duration)}
        </span>
      </div>
    </div>
  );
}

const box = ([x, y, w, h]: [number, number, number, number]): CSSProperties => ({ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });

function SerialStage({ media }: { media: SerialMedia }) {
  return (
    <div className="stage-serial">
      <figure className="serial-photo" style={{ aspectRatio: `${media.photo.w} / ${media.photo.h}` }}>
        <Img src={media.photo.src} alt={media.photo.alt} width={media.photo.w} height={media.photo.h} />
        <span className="serial-hl" style={box(media.highlight)}>
          <em>모델명 불일치</em>
        </span>
      </figure>
      <dl className="ocr">
        <dt className="ocr-head">
          <Icon name="serial" size={14} /> 라벨 판독 (OCR)
        </dt>
        {media.ocr.map((row) => (
          <div key={row.label} className={row.flag ? "tone-" + row.flag : ""}>
            <dt>{row.label}</dt>
            <dd className="mono">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ReceiptStage({ media }: { media: ReceiptMedia }) {
  const total = media.items.reduce((sum, row) => sum + row.price * row.qty, 0);
  if (media.style === "order") {
    return (
      <div className="stage-doc">
        <div className="rc-shot" aria-label="주문 내역 캡처 (견본)">
          <div className="rc-status" aria-hidden="true">
            <span>21:14</span>
            <span className="rc-status-icons">
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="rc-order">
            <p className="rc-app">{media.store}</p>
            <h5>주문 상세</h5>
            <dl className="rc-kv">
              <div>
                <dt>주문번호</dt>
                <dd className="mono">{media.number}</dd>
              </div>
              <div>
                <dt>주문일시</dt>
                <dd>{media.date}</dd>
              </div>
              <div>
                <dt>주문자</dt>
                <dd>{media.buyer}</dd>
              </div>
            </dl>
            {media.items.map((row) => (
              <div className="rc-item" key={row.name}>
                <span className="rc-item-thumb" aria-hidden="true">
                  <Icon name="box" size={18} />
                </span>
                <span>
                  <b>{row.name}</b>
                  <small>수량 {row.qty} · 배송 완료</small>
                </span>
                <strong>{won(row.price)}</strong>
              </div>
            ))}
            <dl className="rc-kv total">
              <div>
                <dt>결제 금액</dt>
                <dd>{won(total)}</dd>
              </div>
              <div>
                <dt>결제 수단</dt>
                <dd>{media.payment}</dd>
              </div>
            </dl>
          </div>
          <span className="rc-stamp">견본 · SAMPLE</span>
        </div>
      </div>
    );
  }
  return (
    <div className="stage-doc thermal-bg">
      <div className="rc-thermal" style={{ "--paper": `url(${PAPER_TEXTURE})` } as CSSProperties} aria-label="카드 영수증 스캔 (견본)">
        <p className="rc-t-store">{media.store}</p>
        <p className="rc-t-small">사업자 000-00-00000 · 가상 상점</p>
        <p className="rc-t-rule" aria-hidden="true" />
        <p className={"rc-t-date" + (media.dateUnclear ? " is-faded" : "")}>
          <span>거래일시</span> {media.date}
        </p>
        <p className="rc-t-small">영수증 {media.number}</p>
        <p className="rc-t-rule" aria-hidden="true" />
        {media.items.map((row) => (
          <p className="rc-t-row" key={row.name}>
            <span>{row.name}</span>
            <span>
              {row.qty} × {row.price ? won(row.price) : "증정"}
            </span>
          </p>
        ))}
        <p className="rc-t-rule" aria-hidden="true" />
        <p className="rc-t-row total">
          <span>합계</span>
          <span>{won(total)}</span>
        </p>
        <p className="rc-t-row">
          <span>결제</span>
          <span>{media.payment}</span>
        </p>
        <p className="rc-t-small center">* 교환·환불은 영수증 지참 *</p>
        <span className="rc-stamp">견본 · SAMPLE</span>
      </div>
      {media.dateUnclear && (
        <span className="rc-callout" style={{ top: "22%" }}>
          <Icon name="idle" size={13} /> 날짜 판독 불가
        </span>
      )}
    </div>
  );
}

function WarrantyStage({ media }: { media: WarrantyMedia }) {
  const ok = media.rows.every((row) => row.match);
  return (
    <div className="stage-doc">
      <div className={"wr " + (ok ? "ok" : "bad")}>
        <header className="wr-head">
          <span className="wr-icon">
            <Icon name={ok ? "warranty" : "block"} size={20} />
          </span>
          <span>
            <b>보증 조회 결과</b>
            <small>데모 응답 · 실제 제조사 조회 아님</small>
          </span>
          <span className={"pill small tone-" + (ok ? "pass" : "block")}>
            <Icon name={ok ? "pass" : "block"} size={12} /> {ok ? "모두 일치" : `${media.rows.filter((row) => !row.match).length}개 불일치`}
          </span>
        </header>
        <div className="wr-query">
          <span>
            조회 시리얼 <code>{media.serial}</code>
          </span>
          <span>{media.queriedAt}</span>
        </div>
        <table className="wr-table">
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col">판매자 입력</th>
              <th scope="col">조회 결과</th>
              <th scope="col">
                <span className="sr-only">일치 여부</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {media.rows.map((row) => (
              <tr key={row.label} className={row.match ? "match" : "diff"}>
                <th scope="row">{row.label}</th>
                <td>{row.claimed}</td>
                <td>{row.found}</td>
                <td>
                  <Icon name={row.match ? "pass" : "block"} size={16} />
                  <span className="sr-only">{row.match ? "일치" : "불일치"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
