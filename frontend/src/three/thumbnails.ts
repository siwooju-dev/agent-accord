import * as THREE from "three";
import type { GpuPalette } from "../looks";
import { buildGpu, CARD_H, type GpuVariant } from "./gpuModel";
import { loadStudioHdr, shadowTexture } from "./studio";

/** Renders still product shots of the procedural card, so listing cards use real renders instead of flat art. */
let renderer: THREE.WebGLRenderer | null = null;
let envCache: { key: string; texture: THREE.Texture } | null = null;
const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

async function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  if (!envCache) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      const hdr = await loadStudioHdr();
      envCache = { key: "hdr", texture: pmrem.fromEquirectangular(hdr).texture };
    } finally {
      pmrem.dispose();
    }
  }
  return renderer;
}

export function renderGpuShots(
  lookId: string,
  palette: GpuPalette,
  items: Array<{ key: string; variant: GpuVariant }>,
  size: { width: number; height: number } = { width: 760, height: 460 },
): Promise<Record<string, string>> {
  const job = queue.then(async () => {
    const result: Record<string, string> = {};
    const pending = items.filter((item) => !cache.has(`${lookId}:${item.key}`));
    if (pending.length) {
      const r = await getRenderer();
      r.setSize(size.width, size.height, false);
      r.toneMappingExposure = palette.exposure;
      const scene = new THREE.Scene();
      scene.environment = envCache!.texture;
      scene.environmentIntensity = palette.envIntensity;
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(3, 5, 4);
      const rim = new THREE.DirectionalLight(new THREE.Color(palette.accent), 0.9);
      rim.position.set(-4, 2, -3);
      scene.add(key, rim);
      const camera = new THREE.PerspectiveCamera(24, size.width / size.height, 0.1, 100);
      camera.position.set(2.5, 1.25, 6.8);
      camera.lookAt(0.05, -0.1, 0);
      const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(palette.shadow), transparent: true, depthWrite: false });
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.5), shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -CARD_H / 2 - 0.3;
      scene.add(shadow);
      for (const item of pending) {
        const model = buildGpu(item.variant);
        model.apply(palette, item.variant);
        model.root.rotation.set(0.04, -0.28, 0);
        scene.add(model.root);
        r.render(scene, camera);
        cache.set(`${lookId}:${item.key}`, r.domElement.toDataURL("image/png"));
        scene.remove(model.root);
        model.root.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
        model.dispose();
      }
      shadowMat.map?.dispose();
      shadowMat.dispose();
      shadow.geometry.dispose();
    }
    items.forEach((item) => {
      const value = cache.get(`${lookId}:${item.key}`);
      if (value) result[item.key] = value;
    });
    return result;
  });
  queue = job.catch(() => undefined);
  return job;
}
