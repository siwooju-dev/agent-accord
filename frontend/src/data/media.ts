/**
 * Real photos and clips for the demo listings, all from Wikimedia Commons under free licenses.
 * Listings and people are still fictional: the files only stand in for what a seller would upload.
 * Receipts and warranty lookups have no real source, so they are rendered as labelled SAMPLE documents.
 */
import feBox from "../assets/media/l1-fe-box.jpg";
import feClose from "../assets/media/l1-fe-close.jpg";
import feUnbox from "../assets/media/l1-fe-unbox.jpg";
import gocBack from "../assets/media/l2-goc-back.jpg";
import gocIo from "../assets/media/l2-goc-io.jpg";
import gocLit from "../assets/media/l2-goc-lit.jpg";
import gocSide from "../assets/media/l2-goc-side.jpg";
import gocTop from "../assets/media/l2-goc-top.jpg";
import strixCase from "../assets/media/l3-strix-case.jpg";
import strixFront from "../assets/media/l3-strix-front.jpg";
import strixRgb from "../assets/media/l3-strix-rgb.jpg";
import strixUnder from "../assets/media/l3-strix-under.jpg";
import serialTag from "../assets/media/ev-serial-tag.jpg";
import gocRunPoster from "../assets/media/ev-goc-run.jpg";
import gocRunClip from "../assets/media/ev-goc-run.mp4";
import gocRunWebm from "../assets/media/ev-goc-run.webm";
import strixRunPoster from "../assets/media/ev-strix-run.jpg";
import strixRunClip from "../assets/media/ev-strix-run.mp4";
import strixRunWebm from "../assets/media/ev-strix-run.webm";
import paper from "../assets/media/paper.jpg";
import r3090Front from "../assets/media/l4-3090-front.jpg";
import r3090Flat from "../assets/media/l4-3090-flat.jpg";
import r3090Io from "../assets/media/l4-3090-io.jpg";
import r4070Fans from "../assets/media/l5-4070-back.jpg";
import r4070Top from "../assets/media/l5-4070-angle.jpg";
import r4070Side from "../assets/media/l5-4070-front.jpg";
import rx7900Front from "../assets/media/l6-7900-rig.jpg";
import rx7900Back from "../assets/media/l6-7900-tuf.jpg";
import r4080Line from "../assets/media/l7-4080-a.jpg";
import r4080Stack from "../assets/media/l7-4080-b.jpg";

export const PAPER_TEXTURE = paper;

export interface Credit {
  author: string;
  license: "CC BY 3.0" | "CC BY 4.0" | "CC BY-SA 4.0" | "CC0";
  title: string;
  url: string;
  edited?: string;
}

const C = {
  zmaslo: (title: string, file: string): Credit => ({
    author: "ZMASLO",
    license: "CC BY 3.0",
    title,
    url: `https://commons.wikimedia.org/wiki/File:${file}`,
    edited: "크롭 · 리사이즈",
  }),
  benlisquare: (title: string, file: string): Credit => ({
    author: "Benlisquare",
    license: "CC BY-SA 4.0",
    title,
    url: `https://commons.wikimedia.org/wiki/File:${file}`,
    edited: "리사이즈",
  }),
  bornInGame: (edited: string): Credit => ({
    author: "BornInGame",
    license: "CC BY 3.0",
    title: "Gigabyte RTX 4090 Gaming OC UNBOXING MOUNT GPU HOLDER",
    url: "https://commons.wikimedia.org/wiki/File:Gigabyte_RTX_4090_Gaming_OC_UNBOXING_MOUNT_GPU_HOLDER.webm",
    edited,
  }),
  invader: (edited: string): Credit => ({
    author: "INVADER PC",
    license: "CC BY 3.0",
    title: "I9-13900KS - ASUS ROG Strix RTX 4090 24G - Lian Li O11 Dynamic EVO Build",
    url: "https://commons.wikimedia.org/wiki/File:I9-13900KS_-_ASUS_ROG_Strix_RTX_4090_24G_-_Lian_Li_O11_Dynamic_EVO_Build-_INVADERPC.webm",
    edited,
  }),
};

export interface Photo {
  id: string;
  src: string;
  w: number;
  h: number;
  alt: string;
  caption: string;
  credit: Credit;
  /** CSS object-position for tight crops */
  focus?: string;
}

export const LISTING_PHOTOS: Record<string, Photo[]> = {
  "listing-01": [
    {
      id: "l1-box",
      src: feBox,
      w: 1600,
      h: 900,
      alt: "검은 박스 위에 놓인 RTX 4090 Founders Edition",
      caption: "박스 · 본체",
      focus: "40% 58%",
      credit: C.zmaslo("NVIDIA RTX 4090 Founders Edition - Verpackung", "NVIDIA_RTX_4090_Founders_Edition_-_Verpackung_(ZMASLO).png"),
    },
    {
      id: "l1-close",
      src: feClose,
      w: 1200,
      h: 676,
      alt: "RTX 4090 로고가 보이는 쉬라우드 근접 사진",
      caption: "쉬라우드 근접",
      credit: C.zmaslo("NVIDIA RTX 4090 Founders Edition - Nahaufnahme", "NVIDIA_RTX_4090_Founders_Edition_-_Nahaufnahme_(ZMASLO).png"),
    },
    {
      id: "l1-unbox",
      src: feUnbox,
      w: 1200,
      h: 676,
      alt: "포장 트레이에 담긴 RTX 4090 Founders Edition",
      caption: "구성품 포장",
      credit: C.zmaslo("NVIDIA RTX 4090 Founders Edition - Unboxing", "NVIDIA_RTX_4090_Founders_Edition_-_Unboxing_(ZMASLO).png"),
    },
  ],
  "listing-02": [
    {
      id: "l2-lit",
      src: gocLit,
      w: 1280,
      h: 720,
      alt: "케이스에 장착되어 GIGABYTE 로고가 켜진 그래픽카드",
      caption: "장착 · 점등",
      credit: C.bornInGame("영상 2:05 지점 캡처"),
    },
    {
      id: "l2-top",
      src: gocTop,
      w: 1280,
      h: 720,
      alt: "팬 3개가 보이는 RTX 4090 Gaming OC 전면",
      caption: "전면 · 팬 3개",
      focus: "50% 55%",
      credit: C.bornInGame("영상 32초 지점 캡처"),
    },
    {
      id: "l2-back",
      src: gocBack,
      w: 1280,
      h: 720,
      alt: "GIGABYTE 로고가 새겨진 백플레이트",
      caption: "백플레이트",
      credit: C.bornInGame("영상 41초 지점 캡처"),
    },
    {
      id: "l2-io",
      src: gocIo,
      w: 1280,
      h: 720,
      alt: "디스플레이 출력 단자가 보이는 브래킷",
      caption: "출력 단자",
      focus: "60% 50%",
      credit: C.bornInGame("영상 35초 지점 캡처"),
    },
    {
      id: "l2-side",
      src: gocSide,
      w: 1280,
      h: 720,
      alt: "히트싱크 핀과 GEFORCE RTX 각인이 보이는 측면",
      caption: "측면 히트싱크",
      credit: C.bornInGame("영상 38초 지점 캡처"),
    },
  ],
  "listing-03": [
    {
      id: "l3-rgb",
      src: strixRgb,
      w: 1400,
      h: 1050,
      alt: "케이스 안에서 RGB가 켜진 ROG Strix RTX 4090",
      caption: "장착 · RGB",
      focus: "55% 60%",
      credit: C.benlisquare("Asus Strix RTX 4090 operational corner view", "Asus_Strix_RTX_4090_operational_corner_view.jpg"),
    },
    {
      id: "l3-front",
      src: strixFront,
      w: 1400,
      h: 732,
      alt: "빨간 배경 위의 ROG Strix RTX 4090 전면",
      caption: "전면",
      credit: C.benlisquare("Asus Strix RTX 4090", "Asus_Strix_RTX_4090.jpg"),
    },
    {
      id: "l3-case",
      src: strixCase,
      w: 1200,
      h: 900,
      alt: "12VHPWR 케이블이 연결된 ROG Strix RTX 4090",
      caption: "전원 케이블",
      credit: C.benlisquare("Asus Strix RTX 4090 operational", "Asus_Strix_RTX_4090_operational.jpg"),
    },
    {
      id: "l3-under",
      src: strixUnder,
      w: 1200,
      h: 900,
      alt: "백플레이트 컷아웃 사이로 보이는 GPU 뒷면 부품",
      caption: "뒷면 · 백플레이트",
      credit: C.benlisquare("Underside of Asus Strix RTX 4090", "Underside_of_Asus_Strix_RTX_4090.jpg"),
    },
  ],
  "listing-04": [
    {
      id: "l4-front",
      src: r3090Front,
      w: 960,
      h: 640,
      alt: "팬 3개가 보이는 GIGABYTE RTX 3090 Eagle OC 전면",
      caption: "전면 · 팬 3개",
      credit: { author: "PantheraLeo1359531", license: "CC BY 4.0", title: "Gigabyte GeForce RTX 3090 Eagle OC 24G, 24576 MiB GDDR6X Front 20201114 DSC5880", url: "https://commons.wikimedia.org/wiki/File:Gigabyte_GeForce_RTX_3090_Eagle_OC_24G,_24576_MiB_GDDR6X_Front_20201114_DSC5880.jpg", edited: "리사이즈" },
    },
    {
      id: "l4-ruler",
      src: r3090Flat,
      w: 960,
      h: 640,
      alt: "줄자 옆에 눕혀 둔 RTX 3090 Eagle OC",
      caption: "길이 실측",
      credit: { author: "PantheraLeo1359531", license: "CC BY 4.0", title: "Gigabyte GeForce RTX 3090 Eagle OC 24G, 24576 MiB GDDR6X liegend Front mit Messung 20201114 DSC5942", url: "https://commons.wikimedia.org/wiki/File:Gigabyte_GeForce_RTX_3090_Eagle_OC_24G,_24576_MiB_GDDR6X_liegend_Front_mit_Messung_20201114_DSC5942.jpg", edited: "리사이즈" },
    },
    {
      id: "l4-io",
      src: r3090Io,
      w: 960,
      h: 640,
      alt: "RTX 3090 Eagle OC 출력 단자",
      caption: "출력 단자",
      credit: { author: "PantheraLeo1359531", license: "CC BY 4.0", title: "Gigabyte GeForce RTX 3090 Eagle OC 24G, 24576 MiB GDDR6X Anschlüsse 20201114", url: "https://commons.wikimedia.org/wiki/File:Gigabyte_GeForce_RTX_3090_Eagle_OC_24G,_24576_MiB_GDDR6X_Anschl%C3%BCsse_20201114.jpg", edited: "리사이즈" },
    },
  ],
  "listing-05": [
    {
      id: "l5-fans",
      src: r4070Fans,
      w: 960,
      h: 597,
      alt: "흰색 RTX 4070 Aero OC의 팬 3개",
      caption: "전면 · 팬 3개",
      credit: { author: "Jacek Halicki", license: "CC BY-SA 4.0", title: "2023 Gigabyte GeForce RTX 4070 Aero OC 12GB (3)", url: "https://commons.wikimedia.org/wiki/File:2023_Gigabyte_GeForce_RTX_4070_Aero_OC_12GB_(3).jpg", edited: "리사이즈" },
    },
    {
      id: "l5-top",
      src: r4070Top,
      w: 960,
      h: 620,
      alt: "위에서 본 RTX 4070 Aero OC 백플레이트",
      caption: "윗면 · 백플레이트",
      credit: { author: "Jacek Halicki", license: "CC BY-SA 4.0", title: "2023 Gigabyte GeForce RTX 4070 Aero OC 12GB (2)", url: "https://commons.wikimedia.org/wiki/File:2023_Gigabyte_GeForce_RTX_4070_Aero_OC_12GB_(2).jpg", edited: "리사이즈" },
    },
    {
      id: "l5-side",
      src: r4070Side,
      w: 960,
      h: 541,
      alt: "옆에서 본 RTX 4070 Aero OC",
      caption: "옆면 · 방열판",
      credit: { author: "Jacek Halicki", license: "CC BY-SA 4.0", title: "2023 Gigabyte GeForce RTX 4070 Aero OC 12GB (1)", url: "https://commons.wikimedia.org/wiki/File:2023_Gigabyte_GeForce_RTX_4070_Aero_OC_12GB_(1).jpg", edited: "리사이즈" },
    },
  ],
  "listing-06": [
    {
      id: "l6-front",
      src: rx7900Front,
      w: 960,
      h: 480,
      alt: "책상 위 ASUS TUF Radeon RX 7900 XTX 전면",
      caption: "전면 · 팬 3개",
      credit: { author: "MoreThanTech", license: "CC BY 3.0", title: "LA MIGLIOR GPU AMD CONTRO LA MIA LIBRERIA STEAM IN 4K + RT! 🚀 (1920p 60fps VP9-128kbit AAC)-00.00.02.579", url: "https://commons.wikimedia.org/wiki/File:LA_MIGLIOR_GPU_AMD_CONTRO_LA_MIA_LIBRERIA_STEAM_IN_4K_%2B_RT!_%F0%9F%9A%80_(1920p_60fps_VP9-128kbit_AAC)-00.00.02.579.png", edited: "영상 캡처 · 리사이즈" },
    },
    {
      id: "l6-back",
      src: rx7900Back,
      w: 960,
      h: 480,
      alt: "ASUS TUF RX 7900 XTX 백플레이트",
      caption: "백플레이트",
      credit: { author: "MoreThanTech", license: "CC BY 3.0", title: "File-MoreThanTech ASUS TUF Gaming Radeon RX 7900 XTX OC Edition 24GB GDDR6 02", url: "https://commons.wikimedia.org/wiki/File:File-MoreThanTech_ASUS_TUF_Gaming_Radeon_RX_7900_XTX_OC_Edition_24GB_GDDR6_02.png", edited: "영상 캡처 · 리사이즈" },
    },
  ],
  "listing-07": [
    {
      id: "l7-line",
      src: r4080Line,
      w: 960,
      h: 540,
      alt: "RTX 4080 SUPER Founders Edition과 비교 카드",
      caption: "가운데 · RTX 4080 SUPER FE",
      credit: { author: "极客湾Geekerwan", license: "CC BY 3.0", title: "Video über die RTX 4080 Super und Vergleichskarten (极客湾Geekerwan) 05", url: "https://commons.wikimedia.org/wiki/File:Video_%C3%BCber_die_RTX_4080_Super_und_Vergleichskarten_(%E6%9E%81%E5%AE%A2%E6%B9%BEGeekerwan)_05.png", edited: "영상 캡처 · 리사이즈" },
    },
    {
      id: "l7-stack",
      src: r4080Stack,
      w: 960,
      h: 540,
      alt: "나란히 놓인 Founders Edition 카드",
      caption: "측면 비교",
      credit: { author: "极客湾Geekerwan", license: "CC BY 3.0", title: "Video über die RTX 4080 Super und Vergleichskarten (极客湾Geekerwan) 06", url: "https://commons.wikimedia.org/wiki/File:Video_%C3%BCber_die_RTX_4080_Super_und_Vergleichskarten_(%E6%9E%81%E5%AE%A2%E6%B9%BEGeekerwan)_06.png", edited: "영상 캡처 · 리사이즈" },
    },
  ],
};

export const coverOf = (listingId: string | undefined) => (listingId ? LISTING_PHOTOS[listingId]?.[0] : undefined);

export type Tone = "pass" | "warn" | "block" | "idle";

export interface Finding {
  tone: Tone;
  text: string;
  /** seconds into the clip the finding refers to */
  at?: number;
}

export interface VideoMedia {
  type: "video";
  src: string;
  webm: string;
  poster: string;
  duration: number;
  chapters: { at: number; label: string }[];
  /** live-looking readout shown over the clip, taken from the clip itself */
  readout?: { from: number; label: string; value: string }[];
  credit: Credit;
}

export interface SerialMedia {
  type: "serial";
  photo: Photo;
  /** percent box [x, y, w, h] on the photo; the serial itself is already redacted in the file */
  highlight: [number, number, number, number];
  ocr: { label: string; value: string; flag?: Tone }[];
}

export interface ReceiptMedia {
  type: "receipt";
  style: "order" | "thermal";
  store: string;
  number: string;
  date: string;
  dateUnclear?: boolean;
  items: { name: string; qty: number; price: number }[];
  payment: string;
  buyer: string;
}

export interface WarrantyMedia {
  type: "warranty";
  queriedAt: string;
  serial: string;
  rows: { label: string; claimed: string; found: string; match: boolean }[];
}

export interface EvidenceView {
  uploadedAt: string;
  uploader: string;
  file: string;
  summary: string;
  findings: Finding[];
  media: VideoMedia | SerialMedia | ReceiptMedia | WarrantyMedia;
}

const serialPhoto: Photo = {
  id: "ev-serial",
  src: serialTag,
  w: 1400,
  h: 788,
  alt: "시리얼 번호, 파트 번호, 바코드가 인쇄된 그래픽카드 박스 라벨",
  caption: "박스 라벨",
  credit: {
    author: "Solomon203",
    license: "CC BY-SA 4.0",
    title: "ASUS GT730-SL-2GD3-BRK Rev1.00 2015-01 box tag",
    url: "https://commons.wikimedia.org/wiki/File:ASUS_GT730-SL-2GD3-BRK_Rev1.00_2015-01_box_tag.jpg",
    edited: "리사이즈 · 시리얼 일부 가림",
  },
};

export const EVIDENCE_VIEWS: Record<string, EvidenceView> = {
  "evidence-01": {
    uploadedAt: "2026-09-27T21:14:00+09:00",
    uploader: "셀러 01",
    file: "order_capture.png · 1170×2532 · 412KB",
    summary: "주문 내역 캡처본이에요. 모델명과 구매일은 매물 설명과 맞지만, 원본(메일·PDF)이 없어 판매자 주장으로 남겨요.",
    findings: [
      { tone: "pass", text: "상품명 RTX 4090 Founders Edition — 매물 모델과 일치" },
      { tone: "pass", text: "주문일 2025-02-14 → 사용 19개월 설명과 일치" },
      { tone: "warn", text: "캡처 이미지라 편집 여부를 확인할 수 없음" },
    ],
    media: {
      type: "receipt",
      style: "order",
      store: "데모 전자몰 (가상)",
      number: "DM-20250214-0•••81",
      date: "2025-02-14 13:52",
      items: [{ name: "NVIDIA GeForce RTX 4090 Founders Edition 24GB", qty: 1, price: 2_590_000 }],
      payment: "신용카드 (번호 가림)",
      buyer: "김*수",
    },
  },
  "evidence-02": {
    uploadedAt: "2026-09-28T14:18:00+09:00",
    uploader: "Accord 조회",
    file: "warranty_lookup.json · 데모 응답",
    summary: "매물 시리얼로 조회한 보증 정보가 판매자 설명과 같아요.",
    findings: [
      { tone: "pass", text: "제품명 · 보증 만료일 모두 판매자 입력과 일치" },
      { tone: "idle", text: "보증 조회는 진품이나 작동 상태를 보장하지 않음" },
    ],
    media: {
      type: "warranty",
      queriedAt: "2026-09-28 14:18",
      serial: "1324 •••• 7781",
      rows: [
        { label: "제품", claimed: "RTX 4090 Founders Edition", found: "GeForce RTX 4090 Founders Edition", match: true },
        { label: "보증 만료", claimed: "2027-02-14", found: "2027-02-14", match: true },
        { label: "등록 상태", claimed: "—", found: "정상 · 도난 신고 없음", match: true },
      ],
    },
  },
  "evidence-03": {
    uploadedAt: "2026-09-26T19:02:00+09:00",
    uploader: "셀러 02",
    file: "gpu_run.mp4 · 11초 · 960×540",
    summary: "장착 후 전원을 켜고, 부하 중 센서 값을 찍은 영상이에요. 외관과 온도는 정상 범위예요.",
    findings: [
      { tone: "pass", at: 1, text: "GIGABYTE · GEFORCE RTX 로고 점등 — 매물 모델 외관과 일치" },
      { tone: "pass", at: 7, text: "센서 로그 GPU 61°C · 핫스팟 75°C · 메모리 50°C" },
      { tone: "warn", text: "영상에 카드 시리얼이 보이지 않아 시리얼 사진과 같은 제품인지 확인 불가" },
    ],
    media: {
      type: "video",
      src: gocRunClip,
      webm: gocRunWebm,
      poster: gocRunPoster,
      duration: 11.5,
      chapters: [
        { at: 0, label: "전원 · RGB 점등" },
        { at: 5.5, label: "센서 로그" },
      ],
      readout: [
        { from: 5.5, label: "GPU", value: "61°C" },
        { from: 5.5, label: "핫스팟", value: "75°C" },
        { from: 5.5, label: "메모리", value: "50°C" },
      ],
      credit: C.bornInGame("2:04–2:09, 2:47–2:53 발췌 · 무음"),
    },
  },
  "evidence-04": {
    uploadedAt: "2026-09-26T19:05:00+09:00",
    uploader: "셀러 02",
    file: "serial_label.jpg · 1600×900 · 1.1MB",
    summary: "박스 라벨 사진이에요. 글자는 읽히지만 라벨의 모델명이 매물과 달라 확인을 보류했어요.",
    findings: [
      { tone: "pass", text: "시리얼 · 파트 번호 · 바코드 판독 완료" },
      { tone: "block", text: "라벨 모델명 GT730-SL-2GD3-BRK — 매물은 RTX 4090 Gaming OC" },
      { tone: "idle", text: "개인정보 보호를 위해 시리얼 앞자리를 가렸어요" },
    ],
    media: {
      type: "serial",
      photo: serialPhoto,
      highlight: [4.9, 52, 36.6, 8.9],
      ocr: [
        { label: "Serial No.", value: "F1YV••••4137" },
        { label: "Part No.", value: "90YV06P0-M0TA00" },
        { label: "Model", value: "GT730-SL-2GD3-BRK", flag: "block" },
      ],
    },
  },
  "evidence-05": {
    uploadedAt: "2026-09-28T14:19:00+09:00",
    uploader: "Accord 조회",
    file: "warranty_lookup.json · 데모 응답",
    summary: "라벨 시리얼로 조회하니 다른 제품(GT 730, 2015년 출고)이 나왔어요. 판매자 설명과 서로 달라요.",
    findings: [
      { tone: "block", text: "조회 모델 GT 730 ≠ 매물 RTX 4090 Gaming OC" },
      { tone: "block", text: "보증 만료 2018-01 ≠ 판매자 입력 2027-09-02" },
      { tone: "warn", text: "승인 전에 카드 본체 시리얼 사진을 다시 요청하세요" },
    ],
    media: {
      type: "warranty",
      queriedAt: "2026-09-28 14:19",
      serial: "F1YV •••• 4137",
      rows: [
        { label: "제품", claimed: "RTX 4090 Gaming OC", found: "GT730-SL-2GD3-BRK", match: false },
        { label: "출고", claimed: "2025-10 (구매)", found: "2015-01", match: false },
        { label: "보증 만료", claimed: "2027-09-02", found: "2018-01 만료", match: false },
      ],
    },
  },
  "evidence-06": {
    uploadedAt: "2026-09-25T22:41:00+09:00",
    uploader: "셀러 03",
    file: "strix_rgb.mp4 · 10초 · 960×540",
    summary: "장착 상태에서 RGB와 팬 회전을 찍은 영상이에요. 부하 테스트 장면은 없어요.",
    findings: [
      { tone: "pass", at: 2, text: "ROG Strix 외관 · 12VHPWR 케이블 연결 확인" },
      { tone: "pass", at: 3, text: "팬 3개 회전 · RGB 점등" },
      { tone: "warn", text: "부하 테스트 · 온도 로그 없음 — 성능 이상은 확인 못 함" },
    ],
    media: {
      type: "video",
      src: strixRunClip,
      webm: strixRunWebm,
      poster: strixRunPoster,
      duration: 10,
      chapters: [
        { at: 0, label: "케이스 · GPU" },
        { at: 6, label: "측면 전체" },
      ],
      credit: C.invader("2:21–2:27, 2:37–2:41 발췌 · 무음"),
    },
  },
  "evidence-07": {
    uploadedAt: "2026-09-25T22:44:00+09:00",
    uploader: "셀러 03",
    file: "receipt_scan.jpg · 1240×1754 · 860KB",
    summary: "카드 영수증 스캔이에요. 상품명은 읽히지만 날짜가 바래 구매 시기를 확인하지 못했어요.",
    findings: [
      { tone: "pass", text: "상품명 ROG-STRIX-RTX4090-O24G — 매물 모델과 일치" },
      { tone: "idle", text: "구매일 판독 불가 → 보증 잔여 기간 계산 보류" },
    ],
    media: {
      type: "receipt",
      style: "thermal",
      store: "아코드 데모상가 3층 (가상)",
      number: "0417-••••-22",
      date: "2025-1?-2? ??:??",
      dateUnclear: true,
      items: [
        { name: "ROG-STRIX-RTX4090-O24G", qty: 1, price: 2_890_000 },
        { name: "12VHPWR 케이블", qty: 1, price: 0 },
      ],
      payment: "카드 · 일시불 (번호 가림)",
      buyer: "—",
    },
  },
};

export const ALL_CREDITS: Credit[] = (() => {
  const seen = new Map<string, Credit>();
  const add = (credit: Credit) => seen.set(credit.url, credit);
  Object.values(LISTING_PHOTOS).flat().forEach((photo) => add(photo.credit));
  Object.values(EVIDENCE_VIEWS).forEach((view) => {
    if (view.media.type === "video") add(view.media.credit);
    if (view.media.type === "serial") add(view.media.photo.credit);
  });
  add({ author: "ambientCG", license: "CC0", title: "Paper 004 (영수증 종이 질감)", url: "https://ambientcg.com/view?id=Paper004" });
  return [...seen.values()];
})();
