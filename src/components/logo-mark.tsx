/**
 * Mote 标志:圆角方块里的播放三角(视频)与一粒琥珀色光点(mote,微尘/光点)。
 * 底色与三角跟随主题的 --ink / --paper,光点固定为品牌琥珀色。
 */
export function LogoMark({ size = 27, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--ink)" />
      <path d="M24 20.5 L43.5 32 L24 43.5 Z" fill="var(--paper)" stroke="var(--paper)" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="47.5" cy="16.5" r="5" fill="#E3A23B" />
    </svg>
  );
}
