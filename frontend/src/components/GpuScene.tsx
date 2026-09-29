import { Layers, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GpuPalette } from "../looks";
import { buildGpu, CARD_H, type GpuModel, type GpuVariant } from "../three/gpuModel";
import { applyStudio, shadowTexture, webglAvailable } from "../three/studio";
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
  variant: GpuVariant;
  hotspots: GpuHotspot[];
}

const HOME = new THREE.Vector3(3.2, 1.35, 6.6);

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

function GpuCanvas({ palette, variant, hotspots }: GpuSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pinRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [exploded, setExploded] = useState(false);
  const [spin, setSpin] = useState(true);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const live = useRef({ palette, variant, hotspots, exploded, spin });
  const versions = useRef({ palette: 0, variant: 0, reset: 0 });
  live.current = { palette, variant, hotspots, exploded, spin };

  useEffect(() => {
    versions.current.palette += 1;
  }, [palette, variant.label, variant.finish]);
  useEffect(() => {
    versions.current.variant += 1;
  }, [variant.fans]);

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "gpu-canvas";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const disposeStudio = applyStudio(renderer, scene);
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    camera.position.copy(HOME);

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.5, 6, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.radius = 8;
    key.shadow.bias = -0.0005;
    const rim = new THREE.DirectionalLight(0xffffff, 1);
    rim.position.set(-4, 2, -4);
    scene.add(key, rim);

    const float = new THREE.Group();
    scene.add(float);
    let model: GpuModel | null = null;
    const mount = () => {
      if (model) {
        float.remove(model.root);
        model.root.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
        model.dispose();
      }
      model = buildGpu(live.current.variant);
      model.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      model.root.rotation.set(0.03, -0.2, 0);
      float.add(model.root);
    };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -CARD_H / 2 - 0.44;
    ground.receiveShadow = true;
    scene.add(ground);
    const blobMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.4), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = ground.position.y + 0.002;
    scene.add(blob);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.minPolarAngle = 0.75;
    controls.maxPolarAngle = 1.62;
    controls.target.set(0, -0.08, 0);
    if (coarse) {
      controls.enableRotate = false;
      renderer.domElement.style.touchAction = "pan-y";
    }
    let idleUntil = 0;
    controls.addEventListener("start", () => {
      idleUntil = performance.now() + 5000;
    });

    let distance = HOME.length();
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
      distance = Math.max(1.28 / Math.tan(vHalf), 2.2 / (Math.tan(vHalf) * camera.aspect));
      camera.position.sub(controls.target).setLength(distance).add(controls.target);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const world = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const timer = new THREE.Timer();
    const applied = { palette: -1, variant: -1, reset: 0 };
    let frame = 0;
    let visible = true;
    let firstFrame = true;

    const loop = (timestamp: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      timer.update(timestamp);
      const t = timer.getElapsed();
      const dt = Math.min(timer.getDelta(), 0.05);
      const state = live.current;
      if (applied.variant !== versions.current.variant) {
        applied.variant = versions.current.variant;
        mount();
        applied.palette = -1;
      }
      if (applied.palette !== versions.current.palette && model) {
        applied.palette = versions.current.palette;
        const p = state.palette;
        model.apply(p, state.variant);
        renderer.toneMappingExposure = p.exposure;
        scene.environmentIntensity = p.envIntensity;
        rim.color.setHex(p.accent);
        rim.intensity = p.rimIntensity;
        (ground.material as THREE.ShadowMaterial).opacity = p.groundShadow;
        blobMat.map?.dispose();
        blobMat.map = shadowTexture(p.shadow);
        blobMat.needsUpdate = true;
      }
      if (applied.reset !== versions.current.reset) {
        applied.reset = versions.current.reset;
        camera.position.copy(HOME).setLength(distance);
      }
      controls.autoRotate = state.spin && !reducedMotion && performance.now() > idleUntil;
      controls.autoRotateSpeed = 0.8;
      controls.update();

      const motion = reducedMotion ? 0 : 1;
      float.position.y = Math.sin(t * 1.1) * 0.045 * motion;
      blob.scale.setScalar(1 - float.position.y * 0.7);
      if (model) {
        model.fans.forEach((fan, index) => {
          fan.rotation.z -= dt * (state.exploded ? 1.2 : 6 + index * 0.35) * motion;
        });
        const target = state.exploded ? 1 : 0;
        const ease = 0.085;
        model.front.position.z += (target * 0.75 - model.front.position.z) * ease;
        model.middle.position.z += (target * 0.2 - model.middle.position.z) * ease;
        model.board.position.z += (target * -0.42 - model.board.position.z) * ease;
        model.back.position.z += (target * -0.98 - model.back.position.z) * ease;
        model.root.rotation.y += ((state.exploded ? -0.62 : -0.2) - model.root.rotation.y) * 0.05;

        camera.getWorldDirection(toCamera).negate();
        const rect = renderer.domElement.getBoundingClientRect();
        const current = model;
        state.hotspots.forEach((spot) => {
          const pin = pinRefs.current[spot.id];
          if (!pin) return;
          const anchor = current.anchors[spot.anchor];
          world.copy(anchor.point);
          anchor.layer.localToWorld(world);
          normal.copy(anchor.normal).transformDirection(current.root.matrixWorld);
          const facing = normal.dot(toCamera);
          world.project(camera);
          pin.style.transform = `translate3d(${((world.x * 0.5 + 0.5) * rect.width).toFixed(1)}px, ${((-world.y * 0.5 + 0.5) * rect.height).toFixed(1)}px, 0)`;
          pin.dataset.facing = facing > -0.05 ? "true" : "false";
        });
      }
      renderer.render(scene, camera);
      if (firstFrame) {
        firstFrame = false;
        setReady(true);
      }
      frame = requestAnimationFrame(loop);
    };
    const wake = () => {
      if (visible && !document.hidden && !frame) frame = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      wake();
    });
    io.observe(host);
    document.addEventListener("visibilitychange", wake);
    wake();

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
      controls.dispose();
      if (model) {
        model.root.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
        model.dispose();
      }
      blobMat.map?.dispose();
      blobMat.dispose();
      blob.geometry.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      disposeStudio();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className={"gpu-scene" + (ready ? " is-ready" : "")}>
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
              aria-label={`${spot.title} · ${spot.detail}`}
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
      <div className="gpu-controls" role="toolbar" aria-label="3D 보기">
        <button type="button" className={exploded ? "is-on" : ""} onClick={() => setExploded((value) => !value)} aria-pressed={exploded}>
          <Layers size={15} strokeWidth={2} /> {exploded ? "조립" : "분해"}
        </button>
        <button type="button" onClick={() => setSpin((value) => !value)} aria-pressed={!spin} aria-label={spin ? "회전 멈춤" : "자동 회전"}>
          {spin ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
        </button>
        <button
          type="button"
          onClick={() => {
            versions.current.reset += 1;
          }}
          aria-label="처음 각도로"
        >
          <RotateCcw size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
