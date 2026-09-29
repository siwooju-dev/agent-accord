import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { GpuPalette } from "../looks";

/** Procedural graphics card. Units ≈ 10 cm. Front of the card faces +z. */
export const CARD_L = 3.3;
export const CARD_H = 1.36;

export type GpuFinish = "silver" | "black" | "white";

export interface GpuVariant {
  fans: 2 | 3;
  label: string;
  finish: GpuFinish;
}

/** Product colourways: each listing keeps its own finish; the active 시안 only changes light and accent. */
const FINISHES: Record<GpuFinish, { shroud: number; rough: number; metal: number; blade: number; bladeOpacity: number; hub: number; trim: number; back: number; fins: number }> = {
  silver: { shroud: 0xbfc5cd, rough: 0.3, metal: 0.88, blade: 0x24272c, bladeOpacity: 1, hub: 0xd5d9df, trim: 0x8d949e, back: 0x7f868f, fins: 0xc9ced6 },
  black: { shroud: 0x1b1c20, rough: 0.36, metal: 0.45, blade: 0x111215, bladeOpacity: 1, hub: 0x2a2c31, trim: 0x3a3d44, back: 0x25272c, fins: 0x8b9099 },
  white: { shroud: 0xf1f3f7, rough: 0.28, metal: 0.04, blade: 0xcfd6df, bladeOpacity: 0.92, hub: 0xffffff, trim: 0xc3cad4, back: 0xd6dbe2, fins: 0xd3d9e1 },
};

export interface GpuModel {
  root: THREE.Group;
  front: THREE.Group;
  middle: THREE.Group;
  board: THREE.Group;
  back: THREE.Group;
  fans: THREE.Group[];
  anchors: Record<"fan" | "back" | "bracket", { point: THREE.Vector3; normal: THREE.Vector3; layer: THREE.Group }>;
  apply: (palette: GpuPalette, variant: GpuVariant) => void;
  dispose: () => void;
}

function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0) {
  const shape = new THREE.Shape();
  const x = cx - w / 2;
  const y = cy - h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function labelTexture(text: string, color: string, width = 1024, height = 64, size = 36) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px "Geist", "Geist Sans", "Pretendard", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const spaced = text.split("").join(String.fromCharCode(8202));
  ctx.fillText(spaced, width / 2, height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Fine brushed-metal roughness map, generated once. */
let brushedTexture: THREE.CanvasTexture | null = null;
function brushed() {
  if (brushedTexture) return brushedTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 900; i += 1) {
    const v = 110 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 64, 30 + Math.random() * 140, 0.6);
  }
  brushedTexture = new THREE.CanvasTexture(canvas);
  brushedTexture.wrapS = THREE.RepeatWrapping;
  brushedTexture.wrapT = THREE.RepeatWrapping;
  brushedTexture.repeat.set(2, 6);
  return brushedTexture;
}

export function buildGpu(variant: GpuVariant): GpuModel {
  const L = CARD_L;
  const H = CARD_H;
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T) => {
    disposables.push(item);
    return item;
  };

  const shroudMat = track(new THREE.MeshPhysicalMaterial({ clearcoat: 0.9, clearcoatRoughness: 0.14 }));
  const faceMat = track(new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.08 }));
  const trimMat = track(new THREE.MeshPhysicalMaterial({ metalness: 0.9, roughness: 0.26, roughnessMap: brushed() }));
  const bladeMat = track(new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0.05, transparent: true, side: THREE.DoubleSide, clearcoat: 0.4 }));
  const hubMat = track(new THREE.MeshPhysicalMaterial({ roughness: 0.22, metalness: 0.2, clearcoat: 1 }));
  const accentMat = track(new THREE.MeshStandardMaterial({ toneMapped: false }));
  const backMat = track(new THREE.MeshPhysicalMaterial({ metalness: 0.9, roughness: 0.3, roughnessMap: brushed() }));
  const pcbMat = track(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25 }));
  const finMat = track(new THREE.MeshStandardMaterial({ metalness: 0.95, roughness: 0.3 }));
  const cavityMat = track(new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.9 }));
  const copperMat = track(new THREE.MeshStandardMaterial({ color: 0xc27a4a, metalness: 1, roughness: 0.2 }));
  const nickelMat = track(new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 1, roughness: 0.18 }));
  const goldMat = track(new THREE.MeshStandardMaterial({ color: 0xe3b25a, metalness: 1, roughness: 0.18 }));
  const steelMat = track(new THREE.MeshStandardMaterial({ color: 0xc6ccd4, metalness: 1, roughness: 0.28, roughnessMap: brushed() }));
  const blackMat = track(new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.55, metalness: 0.2 }));
  const smdMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.6 }));
  const labelMat = track(new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false }));
  const plateLabelMat = track(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.55 }));
  const geo = <T extends THREE.BufferGeometry>(g: T) => track(g);

  const root = new THREE.Group();
  const front = new THREE.Group();
  const middle = new THREE.Group();
  const board = new THREE.Group();
  const back = new THREE.Group();
  root.add(front, middle, board, back);

  // ── shroud body ──
  const body = new THREE.Mesh(geo(new RoundedBoxGeometry(L, H, 0.13, 6, 0.075)), shroudMat);
  body.position.z = 0.185;
  front.add(body);

  // ── faceplate with real fan cut-outs ──
  const fanX = variant.fans === 2 ? [-0.82, 0.82] : [-1.08, 0, 1.08];
  const fanR = 0.49;
  const plateShape = roundedRectShape(L - 0.06, H - 0.06, 0.11);
  fanX.forEach((x) => {
    const hole = new THREE.Path();
    hole.absarc(x, 0, fanR, 0, Math.PI * 2, true);
    plateShape.holes.push(hole);
  });
  const plate = new THREE.Mesh(
    geo(new THREE.ExtrudeGeometry(plateShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 72 })),
    faceMat,
  );
  plate.position.z = 0.25;
  front.add(plate);

  // thin light ring around each fan opening + one short accent line
  const holeRingGeo = geo(new THREE.TorusGeometry(fanR + 0.014, 0.0055, 10, 120));
  fanX.forEach((x) => {
    const ring = new THREE.Mesh(holeRingGeo, accentMat);
    ring.position.set(x, 0, 0.284);
    front.add(ring);
  });
  const edgeBar = new THREE.Mesh(geo(new THREE.BoxGeometry(0.42, 0.012, 0.008)), accentMat);
  edgeBar.position.set(L / 2 - 0.42, -H / 2 + 0.085, 0.284);
  front.add(edgeBar);

  // corner screws
  const screwGeo = geo(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 20));
  [
    [-L / 2 + 0.1, H / 2 - 0.1],
    [L / 2 - 0.1, H / 2 - 0.1],
    [-L / 2 + 0.1, -H / 2 + 0.1],
    [L / 2 - 0.1, -H / 2 + 0.1],
  ].forEach(([x, y]) => {
    const screw = new THREE.Mesh(screwGeo, trimMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, y, 0.29);
    front.add(screw);
  });

  // ── fans ──
  const rootR = 0.12;
  const tipR = 0.435;
  const half = 0.17;
  const sweep = 0.42;
  const bladeShape = new THREE.Shape();
  const steps = 16;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const r = rootR + (tipR - rootR) * t;
    const a = -half + sweep * t * t;
    if (k === 0) bladeShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else bladeShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let k = steps; k >= 0; k -= 1) {
    const t = k / steps;
    const r = rootR + (tipR - rootR) * t;
    const a = half * (0.55 + 0.45 * t) + sweep * t * t;
    bladeShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const bladeGeo = geo(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 }));
  const hubGeo = geo(new THREE.CylinderGeometry(0.115, 0.125, 0.05, 48));
  const hubCapGeo = geo(new THREE.CircleGeometry(0.1, 48));
  const hubRingGeo = geo(new THREE.TorusGeometry(0.083, 0.008, 12, 64));
  const bladeRingGeo = geo(new THREE.TorusGeometry(tipR + 0.004, 0.007, 10, 96));
  const cavityGeo = geo(new THREE.CylinderGeometry(fanR, fanR, 0.1, 72, 1, true));
  const floorGeo = geo(new THREE.CircleGeometry(fanR, 72));
  const strutGeo = geo(new THREE.BoxGeometry(fanR * 2 - 0.02, 0.02, 0.012));
  const fans: THREE.Group[] = [];
  const hubCapMats: THREE.MeshBasicMaterial[] = [];
  fanX.forEach((x) => {
    // recessed tunnel so the fan sits inside the shroud
    const tunnel = new THREE.Mesh(cavityGeo, cavityMat);
    tunnel.rotation.x = Math.PI / 2;
    tunnel.position.set(x, 0, 0.225);
    front.add(tunnel);
    const floor = new THREE.Mesh(floorGeo, cavityMat);
    floor.position.set(x, 0, 0.176);
    front.add(floor);
    [0, Math.PI / 3, (2 * Math.PI) / 3].forEach((angle) => {
      const strut = new THREE.Mesh(strutGeo, blackMat);
      strut.rotation.z = angle;
      strut.position.set(x, 0, 0.185);
      front.add(strut);
    });
    const fan = new THREE.Group();
    fan.position.set(x, 0, 0.215);
    for (let k = 0; k < 11; k += 1) {
      const holder = new THREE.Group();
      holder.rotation.z = (k / 11) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.rotation.x = 0.46;
      holder.add(blade);
      fan.add(holder);
    }
    const ring = new THREE.Mesh(bladeRingGeo, bladeMat);
    ring.position.z = 0.004;
    fan.add(ring);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.03;
    fan.add(hub);
    const capMat = track(new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }));
    hubCapMats.push(capMat);
    const cap = new THREE.Mesh(hubCapGeo, capMat);
    cap.position.z = 0.0565;
    fan.add(cap);
    const hubRing = new THREE.Mesh(hubRingGeo, accentMat);
    hubRing.position.z = 0.058;
    fan.add(hubRing);
    front.add(fan);
    fans.push(fan);
  });

  // top-edge light bar with the model name
  const topLabel = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.9, 0.12)), labelMat);
  topLabel.rotation.x = -Math.PI / 2;
  topLabel.position.set(0.25, H / 2 + 0.002, 0.185);
  front.add(topLabel);

  // ── heatsink fins + heat pipes ──
  const finCount = 110;
  const fins = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.01, H - 0.06, 0.31)), finMat, finCount);
  const m = new THREE.Matrix4();
  for (let k = 0; k < finCount; k += 1) {
    m.makeTranslation(-L / 2 + 0.18 + k * ((L - 0.3) / finCount), 0, -0.03);
    fins.setMatrixAt(k, m);
  }
  middle.add(fins);
  [0.3, 0.12, -0.06, -0.24].forEach((y, index) => {
    const z = -0.1 + index * 0.025;
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(L / 2 - 0.2, y, z),
      new THREE.Vector3(-L / 2 + 0.34, y, z),
      new THREE.Vector3(-L / 2 + 0.16, y + 0.1, z + 0.03),
      new THREE.Vector3(-L / 2 + 0.22, H / 2 + 0.035, 0.03 - index * 0.045),
      new THREE.Vector3(0.1 - index * 0.32, H / 2 + 0.04, 0.03 - index * 0.045),
    ]);
    middle.add(new THREE.Mesh(geo(new THREE.TubeGeometry(path, 80, 0.028, 14, false)), index % 2 ? nickelMat : copperMat));
    const endCap = new THREE.Mesh(geo(new THREE.SphereGeometry(0.029, 16, 10)), nickelMat);
    endCap.position.copy(path.getPoint(1));
    middle.add(endCap);
  });

  // ── board ──
  const pcb = new THREE.Mesh(geo(new THREE.BoxGeometry(L - 0.1, H - 0.04, 0.028)), pcbMat);
  pcb.position.set(0.02, -0.02, -0.235);
  board.add(pcb);
  const fingers = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.02, 0.1, 0.032)), goldMat, 42);
  for (let k = 0; k < 42; k += 1) {
    const gap = k > 10 ? 0.02 : 0;
    m.makeTranslation(-1.2 + k * 0.032 + gap, -H / 2 - 0.07, -0.235);
    fingers.setMatrixAt(k, m);
  }
  board.add(fingers);
  const smd = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.035, 0.05, 0.02)), smdMat, 36);
  for (let k = 0; k < 36; k += 1) {
    m.makeTranslation(1.15 + (k % 6) * 0.05, -0.4 + Math.floor(k / 6) * 0.1, -0.26);
    smd.setMatrixAt(k, m);
  }
  board.add(smd);
  const power = new THREE.Mesh(geo(new RoundedBoxGeometry(0.34, 0.1, 0.17, 2, 0.02)), blackMat);
  power.position.set(1.05, H / 2 + 0.025, -0.15);
  board.add(power);
  const pins = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.03, 0.012, 0.03)), goldMat, 12);
  for (let k = 0; k < 12; k += 1) {
    m.makeTranslation(0.93 + (k % 6) * 0.048, H / 2 + 0.078, -0.19 + Math.floor(k / 6) * 0.07);
    pins.setMatrixAt(k, m);
  }
  board.add(pins);

  // IO bracket with hex vents and ports
  const bracket = new THREE.Mesh(geo(new THREE.BoxGeometry(0.022, H + 0.24, 0.64)), steelMat);
  bracket.position.set(-L / 2 - 0.035, 0.07, -0.03);
  board.add(bracket);
  const hexGeo = geo(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 6));
  const vents = new THREE.InstancedMesh(hexGeo, cavityMat, 40);
  let vent = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 5 && vent < 40; col += 1) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
      m.compose(new THREE.Vector3(-L / 2 - 0.047, 0.62 - row * 0.075, 0.24 - col * 0.07 - (row % 2) * 0.035), q, new THREE.Vector3(1, 1, 1));
      vents.setMatrixAt(vent, m);
      vent += 1;
    }
  }
  board.add(vents);
  const portGeo = geo(new RoundedBoxGeometry(0.03, 0.17, 0.08, 2, 0.012));
  for (let k = 0; k < 4; k += 1) {
    const port = new THREE.Mesh(portGeo, k === 1 ? nickelMat : blackMat);
    port.position.set(-L / 2 - 0.05, -0.02 - k * 0.2, -0.17);
    board.add(port);
  }

  // ── backplate ──
  const backShape = roundedRectShape(L, H, 0.07);
  const flow = new THREE.Path();
  const fx = 0.95;
  flow.moveTo(fx - 0.38, -0.3);
  flow.lineTo(fx + 0.38, -0.3);
  flow.lineTo(fx + 0.38, 0.3);
  flow.lineTo(fx - 0.38, 0.3);
  flow.closePath();
  backShape.holes.push(flow);
  const backplate = new THREE.Mesh(
    geo(new THREE.ExtrudeGeometry(backShape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 })),
    backMat,
  );
  backplate.position.z = -0.31;
  back.add(backplate);
  const plateLabel = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.2, 0.08)), plateLabelMat);
  plateLabel.rotation.y = Math.PI;
  plateLabel.position.set(-0.55, -0.42, -0.322);
  back.add(plateLabel);

  const anchors: GpuModel["anchors"] = {
    fan: { point: new THREE.Vector3(fanX[0], 0.33, 0.3), normal: new THREE.Vector3(0, 0, 1), layer: front },
    back: { point: new THREE.Vector3(0.95, 0.34, -0.34), normal: new THREE.Vector3(0, 0, -1), layer: back },
    bracket: { point: new THREE.Vector3(-L / 2 - 0.06, 0.45, 0.05), normal: new THREE.Vector3(-1, 0, 0), layer: board },
  };

  const apply = (p: GpuPalette, v: GpuVariant) => {
    const f = FINISHES[v.finish];
    const label = v.label;
    shroudMat.color.setHex(f.shroud);
    shroudMat.roughness = Math.min(1, f.rough + 0.08);
    shroudMat.metalness = f.metal;
    faceMat.color.setHex(f.shroud);
    faceMat.roughness = f.rough;
    faceMat.metalness = f.metal;
    faceMat.roughnessMap = v.finish === "silver" ? brushed() : null;
    faceMat.iridescence = v.finish === "white" ? p.iridescence : 0;
    faceMat.iridescenceIOR = 1.45;
    faceMat.iridescenceThicknessRange = [220, 520];
    faceMat.sheen = p.sheen;
    faceMat.sheenRoughness = 0.45;
    faceMat.sheenColor.setHex(p.accent);
    trimMat.color.setHex(f.trim);
    bladeMat.color.setHex(f.blade);
    bladeMat.opacity = f.bladeOpacity;
    hubMat.color.setHex(f.hub);
    accentMat.color.setHex(p.accent).multiplyScalar(p.accentGlow);
    backMat.color.setHex(f.back);
    pcbMat.color.setHex(p.pcb);
    finMat.color.setHex(f.fins);
    const accentCss = "#" + new THREE.Color(p.accent).getHexString();
    labelMat.map?.dispose();
    labelMat.map = labelTexture(label, accentCss);
    plateLabelMat.map?.dispose();
    plateLabelMat.map = labelTexture("ACCORD · DEMO UNIT · NOT FOR SALE", "#1b1d22", 1024, 64, 30);
    hubCapMats.forEach((mat) => {
      mat.map?.dispose();
      mat.map = labelTexture("A", accentCss, 64, 64, 40);
    });
    [shroudMat, faceMat, trimMat, bladeMat, hubMat, accentMat, backMat, pcbMat, finMat, labelMat, plateLabelMat, ...hubCapMats].forEach((mat) => {
      mat.needsUpdate = true;
    });
  };

  const dispose = () => {
    [labelMat, plateLabelMat, ...hubCapMats].forEach((mat) => mat.map?.dispose());
    disposables.forEach((item) => item.dispose());
  };

  return { root, front, middle, board, back, fans, anchors, apply, dispose };
}
