"use client";

/**
 * Video artwork, filling its box. YouTube's standard thumbnails (hqdefault,
 * sddefault, 0.jpg) are 4:3 with the 16:9 frame letterboxed inside, so they
 * are scaled by 4/3 to crop the black bars rather than showing them.
 */
export default function Poster({ src, className = "" }: { src: string; className?: string }) {
  const letterboxed = /ytimg\.com\/vi\/[^/]+\/(hqdefault|sddefault|0|default)\.jpg/.test(src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`h-full w-full object-cover ${letterboxed ? "scale-[1.34]" : ""} ${className}`}
    />
  );
}
