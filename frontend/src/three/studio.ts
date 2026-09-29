import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import hdrUrl from "../assets/hdri/studio_small_09_1k.hdr?url";

/**
 * Studio lighting shared by the hero scene and the thumbnail renderer.
 * HDRI: "Studio Small 09" by Poly Haven (CC0). Until it loads, RoomEnvironment stands in.
 */
let hdrPromise: Promise<THREE.DataTexture> | null = null;

export function loadStudioHdr(): Promise<THREE.DataTexture> {
  if (!hdrPromise) {
    hdrPromise = new HDRLoader().loadAsync(hdrUrl).then((texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      return texture;
    });
  }
  return hdrPromise;
}

export function applyStudio(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  let env = pmrem.fromScene(room, 0.04).texture;
  scene.environment = env;
  let disposed = false;
  void loadStudioHdr()
    .then((hdr) => {
      if (disposed) return;
      const next = pmrem.fromEquirectangular(hdr).texture;
      env.dispose();
      env = next;
      scene.environment = env;
    })
    .catch(() => {
      /* keep the RoomEnvironment fallback */
    });
  return () => {
    disposed = true;
    env.dispose();
    pmrem.dispose();
    room.dispose();
  };
}

export function shadowTexture(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.55, color.replace(/[\d.]+\)$/, (a) => `${Number.parseFloat(a) * 0.45})`));
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
