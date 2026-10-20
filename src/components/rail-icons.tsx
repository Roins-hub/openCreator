import type { SVGProps } from "react";

/**
 * 左侧导航栏的图标:同一套笔画(1.7、圆头),当前页时 .rail-duo 那层淡淡填色。
 * 创作 = 画框 + 播放 + 灵感星;资产 = 叠放的作品;聊天 = 气泡;文档 = 翻开的书;设置 = 调节滑杆。
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 22, children, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export function CreateIcon(props: IconProps) {
  return <Icon {...props}>
    <rect className="rail-duo" x="3" y="6.5" width="14" height="13" rx="3.5" fill="currentColor" stroke="none" />
    <rect x="3" y="6.5" width="14" height="13" rx="3.5" />
    <path d="M8.6 10.6v4.8l4-2.4z" fill="currentColor" strokeWidth={1.2} />
    <path d="M19.2 2.6l.75 1.75 1.75.75-1.75.75-.75 1.75-.75-1.75-1.75-.75 1.75-.75z" fill="currentColor" strokeWidth={1} />
  </Icon>;
}

export function AssetsIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M7.5 6.2V6A2.5 2.5 0 0 1 10 3.5h8A2.5 2.5 0 0 1 20.5 6v8a2.5 2.5 0 0 1-2.5 2.5h-.4" />
    <rect className="rail-duo" x="3.5" y="7.5" width="13" height="13" rx="2.8" fill="currentColor" stroke="none" />
    <rect x="3.5" y="7.5" width="13" height="13" rx="2.8" />
    <path d="M4 18l3.6-3.6 2.6 2.6 1.6-1.6 4.2 4" />
    <circle cx="12.4" cy="11.6" r="1.2" />
  </Icon>;
}

export function ChatIcon(props: IconProps) {
  const bubble = "M20.5 11.5c0 4-3.8 7.2-8.5 7.2-1.1 0-2.1-.17-3.05-.48L4.5 20l1.25-3.6C4.66 15.1 3.5 13.4 3.5 11.5 3.5 7.5 7.3 4.3 12 4.3s8.5 3.2 8.5 7.2z";
  return <Icon {...props}>
    <path className="rail-duo" d={bubble} fill="currentColor" stroke="none" />
    <path d={bubble} />
    <circle cx="8.3" cy="11.6" r=".6" fill="currentColor" strokeWidth={1.3} />
    <circle cx="12" cy="11.6" r=".6" fill="currentColor" strokeWidth={1.3} />
    <circle cx="15.7" cy="11.6" r=".6" fill="currentColor" strokeWidth={1.3} />
  </Icon>;
}

export function DocsIcon(props: IconProps) {
  const book = "M12 6.6C10.2 5.2 7.8 4.5 4 4.5v13.2c3.8 0 6.2.7 8 2.1 1.8-1.4 4.2-2.1 8-2.1V4.5c-3.8 0-6.2.7-8 2.1z";
  return <Icon {...props}>
    <path className="rail-duo" d={book} fill="currentColor" stroke="none" />
    <path d={book} />
    <path d="M12 6.6v13.2" />
  </Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20" />
    <circle className="rail-duo" cx="15" cy="7" r="2.4" fill="currentColor" stroke="none" />
    <circle className="rail-duo" cx="9" cy="17" r="2.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7" r="2.4" />
    <circle cx="9" cy="17" r="2.4" />
  </Icon>;
}
