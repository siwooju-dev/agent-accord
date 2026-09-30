import { useState, type CSSProperties } from "react";

/** Image with reserved space and a shimmer until it decodes, so photos never shift the layout. */
export function Img({
  src,
  alt,
  width,
  height,
  fit = "cover",
  focus,
  eager = false,
  className = "",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  fit?: "cover" | "contain";
  focus?: string;
  eager?: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={"img " + (loaded ? "is-loaded " : "") + className}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={{ objectFit: fit, objectPosition: focus } as CSSProperties}
        onLoad={() => setLoaded(true)}
        ref={(node) => {
          if (node?.complete && node.naturalWidth > 0) setLoaded(true);
        }}
      />
    </span>
  );
}
