import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleHelp, Film, KeyRound, Music, Settings2, Upload } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";

const sections = [
  ["overview", "开始使用"],
  ["connect", "填写 API Key"],
  ["generate", "生成视频"],
  ["references", "参考素材"],
  ["troubleshooting", "常见问题"],
] as const;

export default function DocsPage() {
  return (
    <main className="docs-page">
      <header className="docs-topbar">
        <Link href="/" className="docs-back"><ArrowLeft size={16} /> 返回工作台</Link>
        <div className="docs-brand"><LogoMark size={25} /><span>TZ 文档</span></div>
        <Link href="/settings" className="docs-settings"><Settings2 size={15} /> 设置</Link>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="文档章节">
          <span className="docs-kicker">VIDEO WORKBENCH</span>
          <nav>{sections.map(([id, label], index) => <a href={`#${id}`} key={id}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}</nav>
        </aside>
        <article className="docs-content">
          <section id="overview" className="docs-hero docs-section">
            <span className="docs-kicker">使用说明 · VIDEO WORKBENCH</span>
            <h1>把一段描述，变成一段视频。</h1>
            <p>TZ 通过 new.tangzhi.org 中转站生成视频。只需要在中转站创建一个 API Key，填到设置里就能开始；每个模型支持的分辨率、时长和素材数量会自动同步。</p>
            <div className="docs-quick-links"><Link href="/settings"><KeyRound size={16} /> 填写 API Key</Link><a href="#generate"><Film size={16} /> 开始生成</a></div>
          </section>
          <section id="connect" className="docs-section">
            <SectionTitle icon={<KeyRound size={17} />} eyebrow="01 · CONNECTION" title="填写 API Key" />
            <p>视频接口已内置为 <code>https://new.tangzhi.org</code>，不需要再配置供应商或模型。</p>
            <div className="docs-steps">
              <Step index="1" title="创建令牌">登录 <a href="https://new.tangzhi.org" target="_blank" rel="noopener noreferrer">new.tangzhi.org</a>，在「令牌」页面创建 API Key。</Step>
              <Step index="2" title="填写到设置">打开左下角「设置」，粘贴 API Key 后点击「保存」，可以先点「验证」确认可用。</Step>
              <Step index="3" title="选择模型">回到首页，在顶部选择视频模型；旁边会显示它的分辨率、时长、素材上限和价格。</Step>
            </div>
            <div className="docs-note"><CheckCircle2 size={16} /><span>API Key 只保存在你当前的浏览器里；「验证」只读取模型列表，不会产生费用。</span></div>
          </section>
          <section id="generate" className="docs-section">
            <SectionTitle icon={<Film size={17} />} eyebrow="02 · GENERATE" title="生成视频" />
            <p>输入镜头描述后按 Enter 提交。比例、分辨率和时长只能选择当前模型支持的值，不支持的选项会显示为灰色。</p>
            <div className="docs-parameter-list">
              <div><strong>文生视频</strong><span>只输入文字，适合从零生成镜头。</span></div>
              <div><strong>首尾帧</strong><span>上传两张图片，固定开头与结尾画面。</span></div>
              <div><strong>参考素材</strong><span>上传图片、视频或音频作为主体、动作、风格或声音参考，数量以模型上限为准。</span></div>
            </div>
            <pre className="docs-code"><code>{`提示词示例：
雨后的东京街头，镜头从低角度缓慢推进，
一名穿浅色风衣的人撑伞走过霓虹倒影，
电影感光影，动作自然，画面稳定。`}</code></pre>
          </section>
          <section id="references" className="docs-section">
            <SectionTitle icon={<Upload size={17} />} eyebrow="03 · MEDIA" title="参考素材" />
            <p>点击输入框左下角的添加按钮，或把文件拖入输入框；输入 <code>@</code> 可以在提示词里引用素材，例如 <code>[图1]</code>、<code>[视频1]</code>、<code>[音频1]</code>。当前模型不支持的素材类型无法添加。</p>
            <div className="docs-media-grid">
              <div><span className="docs-media-icon"><Upload size={16} /></span><strong>图片</strong><small>JPG、PNG、WebP，≤15MB</small></div>
              <div><span className="docs-media-icon"><Film size={16} /></span><strong>视频</strong><small>MP4、MOV，≤45MB</small></div>
              <div><span className="docs-media-icon"><Music size={16} /></span><strong>音频</strong><small>MP3、WAV，≤15MB</small></div>
            </div>
          </section>
          <section id="troubleshooting" className="docs-section docs-last">
            <SectionTitle icon={<CircleHelp size={17} />} eyebrow="04 · HELP" title="常见问题" />
            <details open><summary>提示 API Key 无效</summary><p>到 new.tangzhi.org 的「令牌」页面确认令牌未过期、未禁用，重新复制后在设置里保存并点击「验证」。</p></details>
            <details><summary>任务提交后一直生成中</summary><p>视频是异步任务，通常需要 1–6 分钟。关闭页面后重新打开对应会话，会继续查询结果。</p></details>
            <details><summary>提示余额不足</summary><p>按秒计费的模型会按所选时长预扣费用，任务失败会退回。请到中转站控制台充值后重试。</p></details>
            <details><summary>某个比例或时长点不了</summary><p>每个模型支持的比例、分辨率和时长不同，灰色选项表示当前模型不支持。换一个模型即可使用对应参数。</p></details>
          </section>
        </article>
      </div>
    </main>
  );
}

function SectionTitle({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) {
  return <div className="docs-section-title"><span className="docs-section-icon">{icon}</span><div><span className="docs-kicker">{eyebrow}</span><h2>{title}</h2></div></div>;
}

function Step({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return <div className="docs-step"><span>{index}</span><div><strong>{title}</strong><p>{children}</p></div></div>;
}
