import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleHelp, Film, KeyRound, Music, Settings2, Upload } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";

const sections = [
  ["overview", "开始使用"],
  ["connect", "注册与登录"],
  ["generate", "生成视频"],
  ["references", "参考素材"],
  ["troubleshooting", "常见问题"],
] as const;

export default function DocsPage() {
  return (
    <main className="docs-page">
      <header className="docs-topbar">
        <Link href="/" className="docs-back"><ArrowLeft size={16} /> 返回工作台</Link>
        <div className="docs-brand"><LogoMark size={25} /><span>Mote 文档</span></div>
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
            <p>Mote 通过 1xxai.com 中转站生成视频。注册或登录账号就能开始，不需要手动创建和填写 API Key；余额与 1xxai.com 通用。</p>
            <div className="docs-quick-links"><Link href="/"><KeyRound size={16} /> 登录 / 注册</Link><a href="#generate"><Film size={16} /> 开始生成</a></div>
          </section>
          <section id="connect" className="docs-section">
            <SectionTitle icon={<KeyRound size={17} />} eyebrow="01 · ACCOUNT" title="注册与登录" />
            <p>账号就是 <a href="https://1xxai.com" target="_blank" rel="noopener noreferrer">1xxai.com</a> 的账号：在这里注册的账号也能直接登录 1xxai.com 充值、查看账单；已有 1xxai.com 账号的话直接登录即可。</p>
            <div className="docs-steps">
              <Step index="1" title="注册或登录">点击左下角「登录 / 注册」。注册需要邮箱验证码，新用户赠送额度以中转站设置为准。</Step>
              <Step index="2" title="充值">左下角显示账户余额，点击「充值」会打开 1xxai.com 的充值页面，充值后点「刷新」即可看到。</Step>
              <Step index="3" title="选择模型">回到首页，在顶部选择视频模型；旁边会显示它的分辨率、时长、素材上限和价格。</Step>
            </div>
            <div className="docs-note"><CheckCircle2 size={16} /><span>登录后本站会为账号自动创建一个名为「video.1xxai.com 工作台」的专用令牌，只保存在服务器上；请不要在 1xxai.com 删除它，删除后重新登录会自动再建一个。使用自定义中转站时，仍可以在「设置」里填写自己的 API Key。</span></div>
          </section>
          <section id="generate" className="docs-section">
            <SectionTitle icon={<Film size={17} />} eyebrow="02 · GENERATE" title="生成视频" />
            <p>输入镜头描述（至少 10 个字）后按 Enter 提交。比例、分辨率和时长只能选择当前模型支持的值，不支持的选项会显示为灰色。</p>
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
            <details open><summary>提示登录失效或 API Key 无效</summary><p>退出后重新登录即可，本站会自动为账号补建令牌。使用自定义中转站时，请到对应中转站确认令牌未过期、未禁用。</p></details>
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
