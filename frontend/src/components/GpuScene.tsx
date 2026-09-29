import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { GpuPalette } from "../looks";
import "./GpuScene.css";

export interface GpuHotspot {
  id: string;
  anchor: "fan" | "back" | "bracket";
  title: string;
  detail: string;
  tone: "pass" | "warn" | "block" | "idle";
}

interface GpuSceneProps {
  palette: GpuPalette;
  label: string;
  hotspots: GpuHotspot[];
}

const L = 3.3;
const H = 1.36;

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function makeLabelTexture(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = '700 38px "Geist", "Geist Sans", "Pretendard", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.split("").join(String.fromCharCode(8202)), 512, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeShadowTexture(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function GpuScene(props: GpuSceneProps) {
  const [supported] = useState(webglAvailable);
  if (!supported) {
    return (
      <div className="gpu-scene is-fallback">
        <p>이 브라우저는 3D 미리보기를 지원하지 않아요.</p>
      </div>
    );
  }
  return <GpuCanvas {...props} />;
}

function GpuCanvas({ palette, label, hotspots }: GpuSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pinRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const live = useRef({ palette, label, hotspots, exploded: false, spin: true });
  const paletteVersion = useRef(0);
  const [exploded, setExploded] = useState(false);
  const [spin, setSpin] = useState(true);
  const [openPin, setOpenPin] = useState<string | null>(hotspots[0]?.id ?? null);

  live.current = { palette, label, hotspots, exploded, spin };
  useEffect(() => {
    paletteVersion.current += 1;
  }, [palette, label]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "gpu-canvas";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;

    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    camera.position.set(3.6, 1.7, 6.4);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(-4, 2, -4);
    scene.add(key, rim);

    const card = new THREE.Group();
    const float = new THREE.Group();
    float.add(card);
    scene.add(float);
    card.rotation.set(0.02, -0.18, 0);

    // ── materials (colors applied from the palette) ──
    const shroudMat = new THREE.MeshPhysicalMaterial({ clearcoat: 0.8, clearcoatRoughness: 0.18, sheen: 0.4, sheenRoughness: 0.5 });
    const trimMat = new THREE.MeshPhysicalMaterial({ metalness: 0.6, roughness: 0.3 });
    const bladeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.1, transparent: true, side: THREE.DoubleSide });
    const hubMat = new THREE.MeshPhysicalMaterial({ roughness: 0.25, metalness: 0.3, clearcoat: 1 });
    const accentMat = new THREE.MeshStandardMaterial({ toneMapped: false });
    const backMat = new THREE.MeshPhysicalMaterial({ metalness: 0.85, roughness: 0.32 });
    const pcbMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
    const finMat = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.28 });
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xc27a4a, metalness: 1, roughness: 0.22 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe0b35a, metalness: 1, roughness: 0.2 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.8 });

    // ── layers (grouped so the exploded view can separate them) ──
    const front = new THREE.Group();
    const middle = new THREE.Group();
    const board = new THREE.Group();
    const back = new THREE.Group();
    card.add(front, middle, board, back);

    const shroud = new THREE.Mesh(new RoundedBoxGeometry(L, H, 0.16, 5, 0.07), shroudMat);
    shroud.position.z = 0.19;
    front.add(shroud);

    // fans
    const fans: THREE.Group[] = [];
    // swept blade centred on the +x axis so rotating it about x gives it pitch
    const bladeShape = new THREE.Shape();
    const rootR = 0.13;
    const tipR = 0.445;
    const half = 0.24;
    const sweep = 0.38;
    const steps = 14;
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
      const a = half * (0.6 + 0.4 * t) + sweep * t * t;
      bladeShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: false, curveSegments: 4 });
    [-1.08, 0, 1.08].forEach((x) => {
      const opening = new THREE.Mesh(new THREE.CircleGeometry(0.475, 64), darkMat);
      opening.position.set(x, 0, 0.272);
      front.add(opening);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.022, 16, 96), trimMat);
      bezel.position.set(x, 0, 0.274);
      front.add(bezel);
      const fan = new THREE.Group();
      fan.position.set(x, 0, 0.29);
      for (let k = 0; k < 9; k += 1) {
        const blade = new THREE.Mesh(bladeGeometry, bladeMat);
        const holder = new THREE.Group();
        holder.rotation.z = (k / 9) * Math.PI * 2;
        blade.rotation.x = 0.42;
        holder.add(blade);
        fan.add(holder);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.05, 48), hubMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = 0.02;
      fan.add(hub);
      const hubRing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 12, 64), accentMat);
      hubRing.position.z = 0.047;
      fan.add(hubRing);
      front.add(fan);
      fans.push(fan);
    });

    // accent light bar on the front edge + label on the top edge
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 0.018, 0.012), accentMat);
    lightBar.position.set(0, H / 2 - 0.075, 0.274);
    front.add(lightBar);
    const labelMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false });
    const labelPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.12), labelMat);
    labelPlane.rotation.x = -Math.PI / 2;
    labelPlane.position.set(0.15, H / 2 + 0.002, 0.19);
    front.add(labelPlane);

    // heatsink fins + heat pipes
    const finCount = 104;
    const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, H - 0.2, 0.3), finMat, finCount);
    const m = new THREE.Matrix4();
    for (let k = 0; k < finCount; k += 1) {
      m.makeTranslation(-L / 2 + 0.2 + k * ((L - 0.34) / finCount), 0, -0.02);
      fins.setMatrixAt(k, m);
    }
    middle.add(fins);
    [0.28, 0.12, -0.08, -0.24].forEach((y, index) => {
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(L / 2 - 0.15, y, -0.1 + index * 0.02),
        new THREE.Vector3(-L / 2 + 0.3, y, -0.1 + index * 0.02),
        new THREE.Vector3(-L / 2 + 0.12, y + 0.12, -0.02),
        new THREE.Vector3(-L / 2 + 0.2, H / 2 + 0.02, 0.04 - index * 0.04),
        new THREE.Vector3(0.2 - index * 0.35, H / 2 + 0.03, 0.04 - index * 0.04),
      ]);
      middle.add(new THREE.Mesh(new THREE.TubeGeometry(path, 64, 0.03, 12, false), copperMat));
    });

    // board: PCB, gold edge fingers, power connector, bracket
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(L - 0.12, H - 0.06, 0.03), pcbMat);
    pcb.position.set(0.02, -0.02, -0.235);
    board.add(pcb);
    const fingers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.1, 0.034), goldMat, 40);
    for (let k = 0; k < 40; k += 1) {
      m.makeTranslation(-1.18 + k * 0.034, -H / 2 - 0.07, -0.235);
      fingers.setMatrixAt(k, m);
    }
    board.add(fingers);
    const power = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.1, 0.16, 2, 0.02), darkMat);
    power.position.set(1.05, H / 2 + 0.02, -0.16);
    board.add(power);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.025, H + 0.22, 0.62), steelMat);
    bracket.position.set(-L / 2 - 0.035, 0.07, -0.03);
    board.add(bracket);
    for (let k = 0; k < 3; k += 1) {
      const port = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.2, 0.09, 2, 0.01), darkMat);
      port.position.set(-L / 2 - 0.05, 0.3 - k * 0.28, -0.16);
      board.add(port);
    }
    for (let k = 0; k < 6; k += 1) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.28), darkMat);
      vent.position.set(-L / 2 - 0.05, 0.42 - k * 0.12, 0.12);
      board.add(vent);
    }

    const backplate = new THREE.Mesh(new RoundedBoxGeometry(L, H, 0.035, 3, 0.015), backMat);
    backplate.position.z = -0.29;
    back.add(backplate);
    const cutout = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.46, 0.01, 2, 0.004), darkMat);
    cutout.position.set(0.95, 0.12, -0.31);
    back.add(cutout);

    // soft contact shadow
    const shadowMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.5), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -H / 2 - 0.42;
    scene.add(shadow);

    let appliedVersion = -1;
    const applyPalette = () => {
      const p = live.current.palette;
      renderer.toneMappingExposure = p.exposure;
      shroudMat.color.setHex(p.shroud);
      shroudMat.roughness = p.shroudRoughness;
      shroudMat.metalness = p.shroudMetalness;
      shroudMat.iridescence = p.iridescence;
      shroudMat.iridescenceIOR = 1.5;
      shroudMat.iridescenceThicknessRange = [200, 480];
      shroudMat.sheen = p.sheen;
      shroudMat.sheenColor.setHex(p.accent);
      trimMat.color.setHex(p.trim);
      bladeMat.color.setHex(p.blade);
      bladeMat.opacity = p.bladeOpacity;
      hubMat.color.setHex(p.hub);
      accentMat.color.setHex(p.accent).multiplyScalar(p.accentGlow);
      accentMat.emissive.setHex(p.accent);
      backMat.color.setHex(p.backplate);
      pcbMat.color.setHex(p.pcb);
      finMat.color.setHex(p.fins);
      shadowMat.map?.dispose();
      shadowMat.map = makeShadowTexture(p.shadow);
      shadowMat.needsUpdate = true;
      labelMat.map?.dispose();
      labelMat.map = makeLabelTexture(live.current.label, "#" + new THREE.Color(p.accent).getHexString());
      labelMat.needsUpdate = true;
      [shroudMat, trimMat, bladeMat, hubMat, accentMat, backMat, pcbMat, finMat].forEach((mat) => (mat.needsUpdate = true));
    };

    // ── controls ──
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.minPolarAngle = 0.7;
    controls.maxPolarAngle = 1.75;
    controls.target.set(0, -0.05, 0);
    if (coarse) {
      controls.enableRotate = false;
      renderer.domElement.style.touchAction = "pan-y";
    }
    let idleUntil = 0;
    controls.addEventListener("start", () => {
      idleUntil = performance.now() + 5000;
    });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
      const fitH = 1.35;
      const fitW = 2.25;
      const distance = Math.max(fitH / Math.tan(vHalf), fitW / (Math.tan(vHalf) * camera.aspect));
      camera.position.sub(controls.target).setLength(distance).add(controls.target);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // ── hotspot anchors ──
    const anchors: Record<GpuHotspot["anchor"], { point: THREE.Vector3; normal: THREE.Vector3; layer: THREE.Group }> = {
      fan: { point: new THREE.Vector3(-1.08, 0.3, 0.32), normal: new THREE.Vector3(0, 0, 1), layer: front },
      back: { point: new THREE.Vector3(0.95, 0.12, -0.33), normal: new THREE.Vector3(0, 0, -1), layer: back },
      bracket: { point: new THREE.Vector3(-L / 2 - 0.06, 0.35, 0.05), normal: new THREE.Vector3(-1, 0, 0), layer: board },
    };
    const world = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toCamera = new THREE.Vector3();

    let frame = 0;
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !frame) frame = requestAnimationFrame(loop);
    });
    io.observe(host);
    const timer = new THREE.Timer();
    let slow = 0;
    let samples = 0;

    const loop = (timestamp: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      timer.update(timestamp);
      const t = timer.getElapsed();
      const dt = Math.min(timer.getDelta(), 0.05);
      const state = live.current;
      if (appliedVersion !== paletteVersion.current) {
        appliedVersion = paletteVersion.current;
        applyPalette();
      }
      controls.autoRotate = state.spin && !reducedMotion && performance.now() > idleUntil;
      controls.autoRotateSpeed = 0.9;
      controls.update();

      const motion = reducedMotion ? 0 : 1;
      float.position.y = Math.sin(t * 1.1) * 0.05 * motion;
      shadow.scale.setScalar(1 - float.position.y * 0.6);
      fans.forEach((fan, index) => {
        fan.rotation.z -= dt * (state.exploded ? 1.2 : 5.5 + index * 0.4) * motion;
      });
      const target = state.exploded ? 1 : 0;
      const ease = 0.08;
      front.position.z += (target * 0.7 - front.position.z) * ease;
      middle.position.z += (target * 0.18 - middle.position.z) * ease;
      board.position.z += (target * -0.42 - board.position.z) * ease;
      back.position.z += (target * -0.95 - back.position.z) * ease;
      card.rotation.y += ((state.exploded ? -0.55 : -0.18) - card.rotation.y) * 0.04;

      camera.getWorldDirection(toCamera).negate();
      const rect = renderer.domElement.getBoundingClientRect();
      state.hotspots.forEach((spot) => {
        const pin = pinRefs.current[spot.id];
        if (!pin) return;
        const anchor = anchors[spot.anchor];
        world.copy(anchor.point);
        anchor.layer.localToWorld(world);
        normal.copy(anchor.normal).transformDirection(card.matrixWorld);
        const facing = normal.dot(toCamera);
        world.project(camera);
        const x = (world.x * 0.5 + 0.5) * rect.width;
        const y = (-world.y * 0.5 + 0.5) * rect.height;
        pin.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        pin.dataset.facing = facing > -0.05 ? "true" : "false";
      });

      renderer.render(scene, camera);
      if (t > 2 && samples < 120) {
        samples += 1;
        if (dt > 0.034) slow += 1;
        if (samples === 120 && slow > 70 && renderer.getPixelRatio() > 1) {
          renderer.setPixelRatio(1);
          resize();
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const onVisibility = () => {
      if (!document.hidden && !frame) frame = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
      });
      [shroudMat, trimMat, bladeMat, hubMat, accentMat, backMat, pcbMat, finMat, copperMat, goldMat, steelMat, darkMat, shadowMat, labelMat].forEach((mat) => {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      });
      env.dispose();
      pmrem.dispose();
      room.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="gpu-scene">
      <div ref={hostRef} className="gpu-host" />
      <div className="gpu-pins">
        {hotspots.map((spot) => (
          <div
            key={spot.id}
            ref={(node) => {
              pinRefs.current[spot.id] = node;
            }}
            className={"gpu-pin tone-" + spot.tone + (openPin === spot.id ? " is-open" : "")}
            data-facing="true"
          >
            <button
              type="button"
              className="gpu-pin-dot"
              aria-expanded={openPin === spot.id}
              aria-label={`${spot.title} ${spot.detail}`}
              onClick={() => setOpenPin((current) => (current === spot.id ? null : spot.id))}
            >
              <i />
            </button>
            <div className="gpu-pin-card" role="note">
              <b>{spot.title}</b>
              <span>{spot.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="gpu-controls">
        <button type="button" className={exploded ? "is-on" : ""} onClick={() => setExploded((value) => !value)} aria-pressed={exploded}>
          {exploded ? "조립하기" : "분해해서 보기"}
        </button>
        <button type="button" className={spin ? "is-on" : ""} onClick={() => setSpin((value) => !value)} aria-pressed={spin}>
          {spin ? "회전 멈춤" : "자동 회전"}
        </button>
      </div>
      <p className="gpu-hint">드래그해서 돌려보세요 · 점을 누르면 증빙 상태가 보여요</p>
    </div>
  );
}
