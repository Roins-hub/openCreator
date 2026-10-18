import Link from "next/link";
import {
  ArrowLeft, BookMarked, CheckCircle2, CircleHelp, Film, FolderOpen, ImageIcon, KeyRound, MessageSquare, Music,
  Settings2, Upload,
} from "lucide-react";
import { LogoMark } from "@/components/logo-mark";

const retentionDays = Number(process.env.NEXT_PUBLIC_RETENTION_DAYS) || 60;

const sections = [
  ["overview", "开始使用"],
  ["connect", "填写 API Key"],
  ["image", "生成图片"],
  ["video", "生成视频"],
  ["references", "参考素材"],
  ["prompts", "提示词库"],
  ["workspace", "对话与资产"],
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
          <span className="docs-kicker">TZ WORKBENCH</span>
          <nav>{sections.map(([id, label], index) => <a href={`#${id}`} key={id}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>)}</nav>
        </aside>
        <article className="docs-content">
          <section id="overview" className="docs-hero docs-section">
            <span className="docs-kicker">使用说明 · TZ WORKBENCH</span>
            <h1>一段描述，变成图片和视频。</h1>
            <p>TZ 通过 new.tangzhi.org 中转站生成图片和视频，还可以在「聊天」里和 AI 聊天。只需要在中转站创建一个 API Key，填到设置里就能开始（聊天和提示词优化也可以各用一个能调文本模型的 Key）；每个模型支持的比例、分辨率、时长、素材数量和价格都会自动同步。</p>
            <div className="docs-quick-links">
              <Link href="/settings"><KeyRound size={16} /> 填写 API Key</Link>
              <a href="#image"><ImageIcon size={16} /> 生成图片</a>
              <a href="#video"><Film size={16} /> 生成视频</a>
            </div>
          </section>

          <section id="connect" className="docs-section">
            <SectionTitle icon={<KeyRound size={17} />} eyebrow="02 · CONNECTION" title="填写 API Key" />
            <p>接口已内置为 <code>https://new.tangzhi.org</code>，不需要再配置供应商或模型。</p>
            <div className="docs-steps">
              <Step index="1" title="创建令牌">登录 <a href="https://new.tangzhi.org" target="_blank" rel="noopener noreferrer">new.tangzhi.org</a>，在「令牌」页面创建 API Key。</Step>
              <Step index="2" title="填写到设置">打开左下角「设置」，把 Key 粘贴到「视频 · 图片」后点击「保存」，可以先点「验证」确认可用。「聊天」和「提示词优化」需要文本模型，如果这个 Key 的分组里没有文本模型，就给它们各填一个能用的 Key（选填，不填就沿用同一个）。</Step>
              <Step index="3" title="选择图片或视频">回到首页，在输入框下方点「图片」或「视频」，再从旁边的下拉框选模型；顶部会显示这个模型的参数范围和价格。</Step>
            </div>
            <div className="docs-note"><CheckCircle2 size={16} /><span>API Key 只保存在你当前的浏览器里；「验证」只读取模型列表，不会产生费用。同一个 Key 在任何设备上打开，都能看到同一份对话和资产。</span></div>
          </section>

          <section id="image" className="docs-section">
            <SectionTitle icon={<ImageIcon size={17} />} eyebrow="03 · IMAGE" title="生成图片" />
            <p>切到「图片」，写下画面描述后按 Enter。点输入框下方的参数按钮可以调整：</p>
            <div className="docs-parameter-list">
              <div><strong>图片比例</strong><span>1:1、4:3、3:4、16:9、9:16、21:9，或点「自定义」填任意宽高比（长边不超过短边的 4 倍）。</span></div>
              <div><strong>分辨率</strong><span>1K / 2K / 4K，每档价格和中转站的阶梯计价同步显示。</span></div>
              <div><strong>背景与格式</strong><span>可选透明背景；透明背景需要 PNG 或 WebP。</span></div>
              <div><strong>生成数量</strong><span>一次 1–4 张，每张单独生成、单独计费。</span></div>
            </div>
            <p>上传参考图（最多 20 张）就是按图修改。生成好的图片可以点「做成视频」直接带到视频模型，或点「作参考图」继续改。</p>
          </section>

          <section id="video" className="docs-section">
            <SectionTitle icon={<Film size={17} />} eyebrow="04 · VIDEO" title="生成视频" />
            <p>切到「视频」，输入镜头描述后按 Enter，提示词没有最少字数限制。比例、分辨率和时长只能选当前模型支持的值，不支持的选项显示为灰色。</p>
            <div className="docs-parameter-list">
              <div><strong>文生视频</strong><span>只输入文字，适合从零生成镜头。</span></div>
              <div><strong>参考生成</strong><span>上传图片、视频或音频作为主体、动作、风格或声音参考，数量以模型上限为准。</span></div>
              <div><strong>首尾帧</strong><span>上传两张图片，固定开头与结尾画面。</span></div>
              <div><strong>智能比例</strong><span>有参考图时按第一张图的比例；没有时看提示词里的「竖屏」「抖音」「宽银幕」「1:1」等描述，都没有就用 16:9。最后换成模型支持的最接近的比例。</span></div>
            </div>
            <pre className="docs-code"><code>{`提示词示例：
雨后的东京街头，镜头从低角度缓慢推进，
一名穿浅色风衣的人撑伞走过霓虹倒影，
电影感光影，动作自然，画面稳定。`}</code></pre>
            <p>同一个对话里可以连续提交多个任务，不用等上一个完成。任务卡片会显示开始时间、结束时间和总时长。</p>
          </section>

          <section id="references" className="docs-section">
            <SectionTitle icon={<Upload size={17} />} eyebrow="05 · MEDIA" title="参考素材" />
            <p>点输入框左边的「参考内容」卡片上传（只收图片的模型显示为「参考图」，首尾帧模式显示为「首尾帧」），也可以把文件直接拖进输入框或粘贴图片。卡片下方会写明当前模型能收哪些类型。输入 <code>@</code> 可以从已上传的素材里挑选，并在提示词里引用，例如 <code>[图1]</code>、<code>[视频1]</code>、<code>[音频1]</code>。</p>
            <div className="docs-media-grid">
              <div><span className="docs-media-icon"><Upload size={16} /></span><strong>图片</strong><small>JPG、PNG、WebP，≤15MB</small></div>
              <div><span className="docs-media-icon"><Film size={16} /></span><strong>视频</strong><small>MP4、MOV，≤45MB</small></div>
              <div><span className="docs-media-icon"><Music size={16} /></span><strong>音频</strong><small>MP3、WAV，≤15MB</small></div>
            </div>
          </section>

          <section id="prompts" className="docs-section">
            <SectionTitle icon={<BookMarked size={17} />} eyebrow="06 · PROMPTS" title="提示词库" />
            <p>点输入框下方的书本图标打开提示词库。「使用」替换输入框内容，「追加」接在后面；勾选「同时应用推荐参数」会一起带上比例和时长。</p>
            <div className="docs-parameter-list">
              <div><strong>自己的提示词</strong><span>「新建」会带上输入框里的内容，可以选放进哪个分类。</span></div>
              <div><strong>分组与排序</strong><span>左侧可以新建分组、搜索分类、按住拖动调整分类顺序；把卡片拖到分类上就移过去。</span></div>
              <div><strong>卡片排序</strong><span>手动排序（按住卡片拖动）、最近使用、最常使用、添加时间、名称。</span></div>
              <div><strong>删除与恢复</strong><span>「批量管理」里可以多选删除或移动。内置的提示词和分类删除后进入「已隐藏」，随时可以恢复；自己的提示词删除后无法恢复。</span></div>
            </div>
            <p>输入框下方的 ✨ 按钮会用 AI 把你写的几个字扩写成完整的提示词，不满意可以「撤销优化」。在「设置」里可以指定用哪个模型优化。</p>
          </section>

          <section id="workspace" className="docs-section">
            <SectionTitle icon={<FolderOpen size={17} />} eyebrow="07 · WORKSPACE" title="对话与资产" />
            <div className="docs-parameter-list">
              <div><strong>侧栏对话</strong><span>可以搜索标题和内容；新建分组后，按住对话拖进分组，或用「管理」多选删除、移动。</span></div>
              <div><strong>右侧大纲</strong><span>对话较长时，右边会出现目录线；鼠标移上去可以搜索这个对话里的所有提示词，点一下跳过去。</span></div>
              <div><strong>资产</strong><span>生成的图片和视频都在「资产」里，可以收藏、筛选、下载。</span></div>
              <div><strong><MessageSquare size={13} /> 聊天</strong><span>左侧「聊天」是和 AI 聊天的页面，和工作台共用主题和账号，可以上传图片；在设置里可以给它单独填一个 Key。</span></div>
            </div>
            <div className="docs-note"><CheckCircle2 size={16} /><span>生成的图片、视频和上传的素材会保留 {retentionDays} 天，到期自动删除，需要长期保存请及时下载。对话记录不受影响。</span></div>
          </section>

          <section id="troubleshooting" className="docs-section docs-last">
            <SectionTitle icon={<CircleHelp size={17} />} eyebrow="08 · HELP" title="常见问题" />
            <details open><summary>提示 API Key 无效</summary><p>到 new.tangzhi.org 的「令牌」页面确认令牌未过期、未禁用，重新复制后在设置里保存并点击「验证」。</p></details>
            <details><summary>任务提交后一直生成中</summary><p>视频是异步任务，通常需要 1–6 分钟，长视频或排队时会更久。关闭页面后重新打开对应对话，会继续查询结果。</p></details>
            <details><summary>提示余额不足</summary><p>按秒计费的模型会按所选时长预扣费用，任务失败会退回。请到中转站控制台充值后重试。</p></details>
            <details><summary>某个比例或时长点不了</summary><p>每个模型支持的比例、分辨率和时长不同，灰色选项表示当前模型不支持。换一个模型即可使用对应参数。</p></details>
            <details><summary>传不了视频或音频</summary><p>只有部分视频模型接受视频、音频参考；输入框左边的上传卡片会写明当前模型能收哪些类型，换一个支持的模型即可。</p></details>
            <details><summary>生成的图片尺寸和选的不一样</summary><p>请求会按所选比例和分辨率发出，但实际尺寸以中转站返回为准，个别模型会自行调整。</p></details>
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
