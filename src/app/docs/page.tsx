import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, CircleHelp, Film, KeyRound, Settings2, Upload } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";

const sections = [
  ["overview", "开始使用"],
  ["dola", "配置 Dola Pool"],
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
        <Link href="/settings" className="docs-settings"><Settings2 size={15} /> 模型设置</Link>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="文档章节">
          <span className="docs-kicker">LOCAL VIDEO WORKBENCH</span>
          <nav>{sections.map(([id, label], index) => <a href={`#${id}`} key={id}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}</nav>
        </aside>
        <article className="docs-content">
          <section id="overview" className="docs-hero docs-section">
            <span className="docs-kicker">使用说明 · VIDEO WORKBENCH</span>
            <h1>把一段描述，变成一段视频。</h1>
            <p>这里是 Mote 的本地视频工作台说明。配置好一个视频供应商后，提示词、参考素材、任务状态和生成结果都会留在这台电脑上。</p>
            <div className="docs-quick-links"><Link href="/settings"><KeyRound size={16} /> 配置视频接口</Link><a href="#generate"><Film size={16} /> 开始生成</a></div>
          </section>
          <section id="dola" className="docs-section">
            <SectionTitle icon={<KeyRound size={17} />} eyebrow="01 · CONNECTION" title="配置 Dola Pool" />
            <p>在右下角打开“设置”，新增一个供应商。Dola Pool 使用 OpenAI 兼容的 Bearer API Key，但视频任务路径由 Dola 自己定义。</p>
            <div className="docs-steps">
              <Step index="1" title="选择接口类型">选择 <code>Dola Pool 视频</code>。</Step>
              <Step index="2" title="填写接口地址">填写 <code>https://dola.tangzhi.org/v1</code>。</Step>
              <Step index="3" title="填写客户 Key">使用 Dola 管理面板“API 密钥”里创建的客户 API Key，不要使用管理面板登录密码。</Step>
              <Step index="4" title="添加视频模型">类型选择“视频”，Model ID 填写例如 <code>seedance-2.0</code>，再保存并点击“测试”。</Step>
            </div>
            <div className="docs-note"><CheckCircle2 size={16} /><span>连接测试只读取模型列表，不会提交付费视频生成。</span></div>
          </section>
          <section id="generate" className="docs-section">
            <SectionTitle icon={<Film size={17} />} eyebrow="02 · GENERATE" title="生成视频" />
            <p>回到首页，顶部模型选择器切换到刚才添加的视频模型。输入镜头描述后按 Enter 提交，或点击右下角箭头。</p>
            <div className="docs-parameter-list">
              <div><strong>文生视频</strong><span>只输入文字，适合从零生成镜头。</span></div>
              <div><strong>首帧</strong><span>上传一张图片作为开头画面，再描述运动和镜头。</span></div>
              <div><strong>首尾帧</strong><span>上传两张图片，固定开头与结尾画面。</span></div>
              <div><strong>多图参考</strong><span>上传多张图片，作为主体、风格或场景参考。</span></div>
            </div>
            <pre className="docs-code"><code>{`提示词示例：
雨后的东京街头，镜头从低角度缓慢推进，
一名穿浅色风衣的人撑伞走过霓虹倒影，
电影感光影，动作自然，画面稳定。`}</code></pre>
          </section>
          <section id="references" className="docs-section">
            <SectionTitle icon={<Upload size={17} />} eyebrow="03 · MEDIA" title="参考素材" />
            <p>点击输入框左下角的图片按钮，或把图片拖入输入框。Mote 会把素材保存在本地，并按当前视频模式传递给上游。</p>
            <div className="docs-media-grid">
              <div><span className="docs-media-icon"><Upload size={16} /></span><strong>图片</strong><small>PNG、JPG、WEBP</small></div>
              <div><span className="docs-media-icon"><Film size={16} /></span><strong>视频</strong><small>作为参考素材使用</small></div>
              <div><span className="docs-media-icon"><BookOpen size={16} /></span><strong>本地图库</strong><small>在“资产”中统一查看</small></div>
            </div>
          </section>
          <section id="troubleshooting" className="docs-section docs-last">
            <SectionTitle icon={<CircleHelp size={17} />} eyebrow="04 · HELP" title="常见问题" />
            <details open><summary>模型下拉框为空</summary><p>检查 Base URL 是否以 <code>/v1</code> 结尾、API Key 是否为客户 Key，然后在设置页点击模型“测试”。</p></details>
            <details><summary>任务提交后一直生成中</summary><p>Dola 是异步任务。Mote 会轮询任务状态；关闭页面后重新打开对应会话，可以继续查看任务结果。</p></details>
            <details><summary>视频完成但没有预览</summary><p>检查 Dola Pool 返回的任务是否已经带有稳定视频地址，并确认本机可以访问该地址。也可以在“资产”中查看已下载的结果。</p></details>
            <details><summary>如何更换模型</summary><p>进入设置，在同一个 Dola Pool 供应商下添加另一个视频 Model ID，设置参考图数量和最长时长后保存。</p></details>
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
