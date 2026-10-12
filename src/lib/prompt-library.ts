import type { VideoOptions } from "./types";

export type PromptCategoryId =
  | "cinematic" | "portrait" | "product" | "nature" | "city" | "food"
  | "animal" | "scifi" | "guofeng" | "anime" | "image2video" | "camera";

export interface PromptCategory {
  id: PromptCategoryId;
  name: string;
}

/** 用户自己添加的提示词归到这个分类 */
export const MY_PROMPTS = { id: "mine", name: "我的提示词" } as const;
export type PromptFilter = PromptCategoryId | typeof MY_PROMPTS.id | "all";

export interface PromptTemplate {
  id: string;
  category: PromptCategoryId | typeof MY_PROMPTS.id;
  title: string;
  prompt: string;
  tags: string[];
  /** 推荐参数,使用模板时可一并应用 */
  ratio?: VideoOptions["ratio"];
  duration?: number;
  referenceMode?: VideoOptions["referenceMode"];
}

export const PROMPT_CATEGORIES: PromptCategory[] = [
  { id: "cinematic", name: "电影质感" },
  { id: "portrait", name: "人物写真" },
  { id: "product", name: "产品广告" },
  { id: "nature", name: "自然风光" },
  { id: "city", name: "城市街景" },
  { id: "food", name: "美食" },
  { id: "animal", name: "萌宠动物" },
  { id: "scifi", name: "科幻奇幻" },
  { id: "guofeng", name: "国风古韵" },
  { id: "anime", name: "动画风格" },
  { id: "image2video", name: "图生视频" },
  { id: "camera", name: "运镜模板" },
];

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // ---------- 电影质感 ----------
  {
    id: "cinematic-rain-alley", category: "cinematic", title: "雨夜霓虹追逐",
    prompt: "雨夜的狭窄小巷，一名身穿黑色风衣的男子快步奔跑，身后霓虹招牌倒映在积水里，雨丝在逆光中清晰可见。手持跟拍镜头，轻微晃动，低机位贴地推进。冷青与洋红的对比色调，浅景深，胶片颗粒感，紧张压迫的氛围。",
    tags: ["追逐", "霓虹", "手持"], ratio: "21:9", duration: 10,
  },
  {
    id: "cinematic-desert-walk", category: "cinematic", title: "荒漠孤行者",
    prompt: "广袤的金色沙漠，一位披着长袍的旅人牵着骆驼缓缓走向远方的沙丘，风吹起细沙在空中飘散。超远景航拍，镜头缓慢横移，夕阳低垂，长长的影子拖在沙面上。史诗电影感，暖橙色调，宽银幕构图，辽阔而孤独。",
    tags: ["航拍", "史诗", "夕阳"], ratio: "21:9", duration: 10,
  },
  {
    id: "cinematic-train-window", category: "cinematic", title: "列车窗边回忆",
    prompt: "老式绿皮火车车厢内，一位年轻女子靠在窗边，窗外田野与电线杆飞速掠过，光斑在她脸上明暗交替。镜头从窗外风景缓缓拉回到她的侧脸，她轻轻闭上眼睛。怀旧暖黄色调，柔焦，16mm 胶片质感，安静感伤。",
    tags: ["怀旧", "侧脸", "光影"], ratio: "16:9", duration: 10,
  },
  {
    id: "cinematic-diner-night", category: "cinematic", title: "深夜餐馆",
    prompt: "凌晨的美式路边餐馆，暖黄灯光从玻璃窗透出，一位疲惫的警探独自坐在吧台前搅动咖啡，窗外偶有车灯划过。固定机位缓慢推近，爵士乐般的慵懒节奏。霍珀油画般的构图与配色，高对比光影，孤独都市感。",
    tags: ["夜景", "孤独", "推镜"], ratio: "16:9", duration: 10,
  },

  // ---------- 人物写真 ----------
  {
    id: "portrait-flower-field", category: "portrait", title: "花海回眸",
    prompt: "盛开的薰衣草花海中，一位穿白色长裙的少女背对镜头缓步前行，微风吹动裙摆与长发，她停下脚步回眸微笑。镜头以中景跟随后缓慢环绕到正面，逆光金色发丝轮廓光。清新日系色调，柔和空气感，浪漫唯美。",
    tags: ["回眸", "逆光", "日系"], ratio: "9:16", duration: 5,
  },
  {
    id: "portrait-street-fashion", category: "portrait", title: "街头时装大片",
    prompt: "城市街头斑马线上，一位模特身穿廓形西装外套自信地迎着镜头走来，路人虚化成流动的色块。镜头后退式跟拍，高速快门定格瞬间的衣摆飘动，随后慢动作。高级时装杂志质感，冷调低饱和，锐利清晰。",
    tags: ["时尚", "慢动作", "街拍"], ratio: "9:16", duration: 5,
  },
  {
    id: "portrait-old-craftsman", category: "portrait", title: "老匠人的手",
    prompt: "昏暗的木工作坊里，一位白发老匠人专注地用刨子刨木，木屑卷曲着落下，窗外斜射进一束光照亮漂浮的尘埃。特写镜头从布满皱纹的双手缓缓上移到他专注的眼神。纪录片质感，暖褐色调，伦勃朗光，温情而有力量。",
    tags: ["纪录片", "特写", "匠心"], ratio: "16:9", duration: 10,
  },
  {
    id: "portrait-dancer", category: "portrait", title: "舞者剪影",
    prompt: "空旷的排练厅，一位现代舞者在巨大的落地窗前旋转跳跃，身体在逆光下形成优美剪影，白色纱幔随风起伏。镜头围绕舞者 360 度环绕，动作以 50% 慢动作呈现。黑白与淡金色调，极简构图，诗意而富有张力。",
    tags: ["舞蹈", "剪影", "环绕"], ratio: "16:9", duration: 10,
  },

  // ---------- 产品广告 ----------
  {
    id: "product-perfume", category: "product", title: "香水水花特写",
    prompt: "一瓶水晶质感的香水瓶置于黑色镜面台上，清澈的水花从四周慢动作溅起并环绕瓶身，水珠在侧逆光下晶莹闪烁。镜头缓慢环绕 180 度并轻微推近到瓶身标志。奢华广告质感，黑金配色，高光锐利，极致细节。",
    tags: ["奢华", "慢动作", "水花"], ratio: "9:16", duration: 5,
  },
  {
    id: "product-sneaker", category: "product", title: "运动鞋悬浮展示",
    prompt: "一只白色运动鞋在纯色渐变背景中悬浮缓慢旋转，鞋底迸发出彩色粉尘向外扩散，细节纹理清晰可见。镜头从鞋底仰拍缓缓升到侧面平视。潮流品牌广告风格，高饱和撞色，干净利落的棚拍布光，充满活力。",
    tags: ["潮流", "旋转", "粉尘"], ratio: "1:1", duration: 5,
  },
  {
    id: "product-coffee", category: "product", title: "咖啡拉花",
    prompt: "俯拍视角，咖啡师将绵密奶泡缓缓注入深色浓缩咖啡中，拉出一朵精致的郁金香图案，热气袅袅升起。镜头由俯拍慢慢倾斜至 45 度，微距浅景深。温暖的咖啡馆晨光，奶油棕色调，治愈生活感。",
    tags: ["俯拍", "微距", "治愈"], ratio: "1:1", duration: 5,
  },
  {
    id: "product-phone", category: "product", title: "科技产品发布",
    prompt: "一部轻薄手机在黑暗空间中从阴影里缓缓转出，一道流光沿着金属边框扫过，屏幕亮起显示抽象的彩色光波。镜头极慢速推近到摄像头模组的特写。苹果发布会式极简风格，深灰与银色，精准的轮廓光，未来科技感。",
    tags: ["科技", "流光", "极简"], ratio: "16:9", duration: 5,
  },
  {
    id: "product-skincare", category: "product", title: "护肤品清透质地",
    prompt: "一滴透明精华液从滴管中缓缓落下，落在浅粉色玻璃瓶旁的水面上荡开层层涟漪，周围点缀新鲜花瓣与水珠。微距慢动作镜头，柔和的顶光与反光板补光。清透干净的美妆广告质感，粉白配色，温柔高级。",
    tags: ["美妆", "微距", "清透"], ratio: "9:16", duration: 5,
  },

  // ---------- 自然风光 ----------
  {
    id: "nature-sea-of-clouds", category: "nature", title: "云海日出",
    prompt: "高山之巅，翻涌的云海在脚下缓缓流动，太阳从地平线升起，金色光芒穿透云层洒向连绵山峰。延时摄影效果，镜头从山脊缓慢横移，云层流速加快。壮丽的自然纪录片质感，金橙与冷蓝的渐变天空，震撼宁静。",
    tags: ["延时", "日出", "航拍"], ratio: "21:9", duration: 10,
  },
  {
    id: "nature-aurora", category: "nature", title: "极光冰湖",
    prompt: "冰岛的夜空下，绿色与紫色的极光如丝带般舞动，倒映在平静的冰湖湖面上，远处雪山轮廓清晰，漫天繁星。广角镜头缓慢上摇，从湖面倒影到星空。梦幻而真实的天文摄影质感，深蓝夜色，神秘静谧。",
    tags: ["极光", "星空", "倒影"], ratio: "16:9", duration: 10,
  },
  {
    id: "nature-forest-light", category: "nature", title: "森林丁达尔光",
    prompt: "清晨的原始森林，薄雾弥漫，阳光穿过高大树冠形成一道道丁达尔光束，蕨类植物上挂着露珠，远处一只小鹿抬头张望。镜头沿林间小道缓慢向前推进。清新的绿色调，柔和光影，宁静神圣的氛围。",
    tags: ["光束", "晨雾", "推进"], ratio: "16:9", duration: 10,
  },
  {
    id: "nature-ocean-waves", category: "nature", title: "海浪礁石",
    prompt: "碧蓝的海浪层层涌来，猛烈拍打在黑色火山礁石上激起巨大白色浪花，水雾在阳光下形成小彩虹。低机位贴近海面的慢动作镜头，随后无人机拉升展现整片海岸线。高清纪录片质感，高对比，力量感十足。",
    tags: ["海浪", "慢动作", "拉升"], ratio: "16:9", duration: 10,
  },

  // ---------- 城市街景 ----------
  {
    id: "city-tokyo-crossing", category: "city", title: "都市十字路口",
    prompt: "夜晚繁华的十字路口，人潮在斑马线上交汇穿行，巨型广告屏闪烁着彩色光芒，雨后路面反射霓虹。俯视延时摄影，人流形成光影轨迹，随后镜头降落到一位驻足仰望的行人身旁。赛博都市感，青橙色调，热闹而疏离。",
    tags: ["延时", "人潮", "夜景"], ratio: "16:9", duration: 10,
  },
  {
    id: "city-old-street", category: "city", title: "老街烟火气",
    prompt: "傍晚的南方老街，两旁是斑驳的骑楼与挂满灯笼的小吃摊，炊烟袅袅，孩子们追逐嬉戏穿过人群。镜头以步行视角缓慢前进，偶尔停留在摊主翻炒的铁锅特写。暖黄灯光，浓郁的生活气息，温暖怀旧。",
    tags: ["烟火气", "步行视角", "怀旧"], ratio: "16:9", duration: 10,
  },
  {
    id: "city-skyline-dusk", category: "city", title: "城市天际线蓝调时刻",
    prompt: "蓝调时刻的城市天际线，摩天大楼的灯光依次亮起，江面上游船缓缓驶过留下光带，天空由橙粉渐变为深蓝。无人机从江面低空起飞，缓慢拉高并环绕城市中心。现代都市宣传片质感，清晰锐利，大气繁华。",
    tags: ["天际线", "航拍", "蓝调"], ratio: "21:9", duration: 10,
  },
  {
    id: "city-subway", category: "city", title: "地铁站的人来人往",
    prompt: "早高峰的地铁站台，列车呼啸进站，车门打开人群涌出，一位戴耳机的女孩逆着人流静静站立。慢门拍摄，人群化为流动的虚影而女孩清晰静止。冷白荧光灯色调，对比强烈，都市孤独感。",
    tags: ["慢门", "动静对比", "通勤"], ratio: "9:16", duration: 5,
  },

  // ---------- 美食 ----------
  {
    id: "food-ramen", category: "food", title: "热汤拉面",
    prompt: "一碗热气腾腾的豚骨拉面，筷子缓缓夹起弹牙的面条，汤汁顺着面条滴落，溏心蛋切面流出金黄蛋液。微距慢动作特写，侧逆光勾勒出蒸汽轮廓。暖色调美食广告质感，浓郁诱人，食欲感十足。",
    tags: ["微距", "蒸汽", "慢动作"], ratio: "9:16", duration: 5,
  },
  {
    id: "food-steak", category: "food", title: "炙烤牛排",
    prompt: "铸铁锅中厚切牛排滋滋作响，黄油与迷迭香融化冒泡，厨师用勺子将热油浇在牛排表面，火焰短暂窜起。低角度特写，镜头缓慢横移，火光映照。深色背景高级餐厅质感，焦香油润，张力十足。",
    tags: ["火焰", "特写", "高级感"], ratio: "16:9", duration: 5,
  },
  {
    id: "food-fruit-splash", category: "food", title: "水果落水",
    prompt: "新鲜的草莓、蓝莓与柠檬片依次落入清澈的气泡水中，溅起晶莹水花，气泡沿杯壁升腾。高速摄影超慢动作，纯白背景明亮布光。清新夏日饮品广告风格，高饱和果色，清爽活泼。",
    tags: ["超慢动作", "清新", "饮品"], ratio: "9:16", duration: 5,
  },
  {
    id: "food-dumplings", category: "food", title: "手工包饺子",
    prompt: "木质案板上，一双手熟练地擀皮、放馅、捏出褶子，一个个饺子整齐排列，随后下锅翻滚浮起。俯拍与特写交替，节奏轻快。温暖的家庭厨房灯光，米白与木色调，满满的团圆与家的味道。",
    tags: ["俯拍", "手部特写", "家常"], ratio: "16:9", duration: 10,
  },

  // ---------- 萌宠动物 ----------
  {
    id: "animal-cat-window", category: "animal", title: "窗台上的猫",
    prompt: "午后阳光洒在窗台上，一只橘猫慵懒地伸了个懒腰，然后被窗外飞过的蝴蝶吸引，耳朵竖起、尾巴轻摆，伸出爪子轻轻拍向玻璃。中景固定镜头，柔和自然光。温馨治愈的生活记录风格，暖色调，可爱灵动。",
    tags: ["治愈", "猫咪", "自然光"], ratio: "9:16", duration: 5,
  },
  {
    id: "animal-dog-beach", category: "animal", title: "金毛海边奔跑",
    prompt: "一只金毛犬在夕阳下的沙滩上欢快奔跑，耳朵随风飘起，溅起一串浪花，嘴里叼着飞盘。低机位跟拍，慢动作，逆光中毛发闪着金光。欢乐明亮的暖色调，充满活力与自由感。",
    tags: ["奔跑", "逆光", "慢动作"], ratio: "16:9", duration: 5,
  },
  {
    id: "animal-panda", category: "animal", title: "熊猫吃竹子",
    prompt: "竹林中一只大熊猫坐在地上，用前爪握着竹子咔嚓咔嚓地啃食，偶尔抬头憨憨地看向镜头，旁边一只熊猫幼崽在打滚。自然纪录片镜头，中景缓慢推近。清新翠绿色调，自然柔光，憨态可掬。",
    tags: ["纪录片", "憨萌", "竹林"], ratio: "16:9", duration: 10,
  },
  {
    id: "animal-whale", category: "animal", title: "座头鲸跃出海面",
    prompt: "湛蓝的海洋中，一头巨大的座头鲸破浪跃出水面，身体在空中翻转后重重砸回海里，激起壮观水花。远处一艘小船作为比例参照。无人机高空俯拍转慢动作。海洋纪录片质感，震撼壮阔。",
    tags: ["海洋", "航拍", "震撼"], ratio: "21:9", duration: 10,
  },

  // ---------- 科幻奇幻 ----------
  {
    id: "scifi-cyber-city", category: "scifi", title: "赛博朋克飞行车",
    prompt: "未来都市的高空，一辆飞行汽车在摩天楼群之间穿梭，全息广告投影在雨幕中闪烁，下方是层层叠叠的霓虹街道。第一人称驾驶视角高速穿越，随后切换为追车镜头。赛博朋克美学，青紫色调，体积光，速度感强烈。",
    tags: ["赛博朋克", "第一人称", "速度感"], ratio: "21:9", duration: 10,
  },
  {
    id: "scifi-astronaut", category: "scifi", title: "宇航员与星球",
    prompt: "一名宇航员漂浮在太空中，面罩上倒映着巨大的蓝色行星与星环，远处太阳缓缓升起，光芒照亮宇航服的细节。镜头从面罩反射缓慢拉远到全景。史诗科幻电影质感，冷蓝与金色对比，宏大而静谧。",
    tags: ["太空", "拉远", "史诗"], ratio: "21:9", duration: 10,
  },
  {
    id: "scifi-magic-library", category: "scifi", title: "魔法图书馆",
    prompt: "古老的魔法图书馆，高耸的书架延伸入云，书本自行飞出书架在空中翻页，发光的文字像萤火虫一样飘散。一位年轻法师抬手，光点汇聚成一本发光的书落入掌心。镜头缓慢上升环绕。奇幻电影质感，暖金色调，神秘梦幻。",
    tags: ["魔法", "奇幻", "环绕"], ratio: "16:9", duration: 10,
  },
  {
    id: "scifi-mech", category: "scifi", title: "巨型机甲苏醒",
    prompt: "废墟城市中，一台布满锈迹的巨型机甲缓缓站起，瓦砾从它身上滚落，双眼亮起蓝色光芒，远处烟尘弥漫。仰拍镜头缓慢推进，地面随之震动。硬核科幻质感，灰蓝色调，体积光与烟雾，压迫感强烈。",
    tags: ["机甲", "仰拍", "压迫感"], ratio: "16:9", duration: 10,
  },

  // ---------- 国风古韵 ----------
  {
    id: "guofeng-hanfu-bamboo", category: "guofeng", title: "竹林汉服剑舞",
    prompt: "翠绿竹林间，一位身着白色汉服的女侠手持长剑翩然起舞，衣袂飘飘，竹叶随剑气纷飞。镜头环绕跟随剑势，关键动作慢动作定格。武侠电影质感，青绿与月白配色，飘逸潇洒，东方意境。",
    tags: ["汉服", "武侠", "慢动作"], ratio: "16:9", duration: 10,
  },
  {
    id: "guofeng-ink-landscape", category: "guofeng", title: "水墨山水动起来",
    prompt: "一幅水墨山水画徐徐展开，远山云雾缭绕，江上一叶扁舟缓缓划过，墨色晕染般的飞鸟掠过天际。镜头如长卷般缓慢横移。中国水墨动画风格，黑白灰为主点缀淡青，留白意境，悠远宁静。",
    tags: ["水墨", "长卷", "留白"], ratio: "21:9", duration: 10,
  },
  {
    id: "guofeng-lantern-festival", category: "guofeng", title: "上元灯会",
    prompt: "上元节夜晚的古城长街，千盏花灯高悬，一位提着兔子灯的少女在人群中回首，身后烟花在夜空绽放。镜头从灯笼特写拉开到全景，再推向少女。古装剧质感，红金暖色调，热闹喜庆又带一丝温柔。",
    tags: ["灯会", "古装", "烟花"], ratio: "16:9", duration: 10,
  },
  {
    id: "guofeng-tea", category: "guofeng", title: "茶道禅意",
    prompt: "禅意茶室中，一双手缓缓注水入盏，茶叶在杯中舒展沉浮，窗外细雨打在芭蕉叶上。特写与空镜交替，节奏极慢。素雅的新中式美学，原木与墨绿色调，安静克制，禅意悠长。",
    tags: ["茶道", "禅意", "新中式"], ratio: "16:9", duration: 10,
  },

  // ---------- 动画风格 ----------
  {
    id: "anime-summer", category: "anime", title: "日系动画夏日",
    prompt: "日系动画风格，夏日午后的乡间小路，穿着校服的少女骑着自行车驶过，积雨云高耸，蝉鸣声中风吹动路边的向日葵。镜头跟随自行车平移，天空湛蓝。新海诚式高饱和光影，细腻背景美术，青春怀念感。",
    tags: ["新海诚风", "青春", "夏日"], ratio: "16:9", duration: 10,
  },
  {
    id: "anime-clay", category: "anime", title: "黏土定格动画",
    prompt: "黏土定格动画风格，一只小刺猬在蘑菇森林里推着一颗大苹果前进，苹果滚过小坡，刺猬追着跑并摔了个跟头。定格动画的轻微帧跳感，手工质感纹理。温暖柔和的色彩，童趣可爱。",
    tags: ["定格动画", "童趣", "手工"], ratio: "4:3", duration: 5,
  },
  {
    id: "anime-3d-cartoon", category: "anime", title: "3D 卡通冒险",
    prompt: "皮克斯风格的 3D 卡通，一个圆滚滚的小机器人在废弃仓库里发现一株发芽的小植物，好奇地伸出机械手轻轻触碰，眼睛屏幕变成爱心。镜头缓慢推近到表情特写。明亮温暖的色彩，精致材质与柔和布光，温馨动人。",
    tags: ["3D", "卡通", "温馨"], ratio: "16:9", duration: 5,
  },
  {
    id: "anime-pixel", category: "anime", title: "像素风游戏场景",
    prompt: "复古像素风格，一名小骑士在横版关卡中奔跑跳跃，越过尖刺陷阱，收集闪闪发光的金币，背景是多层视差滚动的城堡与夜空。横向卷轴镜头。16 位游戏机色彩，怀旧而充满活力。",
    tags: ["像素", "复古游戏", "横版"], ratio: "16:9", duration: 5,
  },

  // ---------- 图生视频(需要参考图) ----------
  {
    id: "i2v-bring-alive", category: "image2video", title: "让照片动起来",
    prompt: "让[图1]中的画面自然地动起来：人物轻轻眨眼、微笑，发丝与衣角随微风轻轻摆动，背景保持稳定。镜头缓慢推近，保持原图的构图、光线与色调不变。",
    tags: ["首帧", "微动", "保持一致"], ratio: "adaptive", duration: 5, referenceMode: "first",
  },
  {
    id: "i2v-character-action", category: "image2video", title: "角色做出动作",
    prompt: "[图1]中的角色转身望向镜头，然后向前迈步走出画面，保持角色的服装、发型与面部特征一致。镜头跟随角色移动，背景环境与光线风格参考原图。",
    tags: ["角色一致", "动作", "跟拍"], ratio: "adaptive", duration: 5, referenceMode: "references",
  },
  {
    id: "i2v-first-last", category: "image2video", title: "首尾帧转场",
    prompt: "从[图1]的画面自然过渡到[图2]的画面，中间通过流畅的镜头运动与光影变化完成衔接，主体动作连贯，没有突兀的跳变。",
    tags: ["首尾帧", "转场", "衔接"], ratio: "adaptive", duration: 5, referenceMode: "first_last",
  },
  {
    id: "i2v-product-spin", category: "image2video", title: "商品图变展示视频",
    prompt: "以[图1]中的商品为主体，在干净的纯色背景上缓慢旋转 360 度展示外观细节，一道柔和的高光沿着商品表面扫过。保持商品的形状、颜色与标识完全一致。",
    tags: ["电商", "旋转", "保持一致"], ratio: "1:1", duration: 5, referenceMode: "references",
  },

  // ---------- 运镜模板(替换【】中的内容) ----------
  {
    id: "camera-dolly-in", category: "camera", title: "缓慢推镜聚焦",
    prompt: "【主体】位于画面中央，镜头从远景缓慢匀速推近到面部或细节特写，背景逐渐虚化，营造情绪聚焦的效果。【场景与光线描述】，电影质感。",
    tags: ["推镜", "模板"], ratio: "16:9", duration: 5,
  },
  {
    id: "camera-orbit", category: "camera", title: "360 度环绕",
    prompt: "镜头围绕【主体】做 360 度匀速环绕运动，主体保持在画面中心，背景随环绕产生视差变化。【场景与光线描述】，动作流畅稳定。",
    tags: ["环绕", "模板"], ratio: "16:9", duration: 10,
  },
  {
    id: "camera-crane-up", category: "camera", title: "升格揭示全景",
    prompt: "镜头从【主体】的近景开始，缓慢向上升起并向后拉远，逐渐揭示出【周围的宏大场景】的全貌，结尾停留在大全景。电影开场镜头感。",
    tags: ["升降", "揭示", "模板"], ratio: "21:9", duration: 10,
  },
  {
    id: "camera-fpv", category: "camera", title: "FPV 穿越",
    prompt: "FPV 无人机视角高速穿越【场景，例如：峡谷/建筑群/森林】，贴近障碍物飞行并做出俯冲、侧翻和急转，最后冲出开阔地带迎向【结尾画面】。速度感极强，画面流畅。",
    tags: ["FPV", "穿越", "模板"], ratio: "16:9", duration: 10,
  },
  {
    id: "camera-hitchcock", category: "camera", title: "希区柯克变焦",
    prompt: "对【主体】使用希区柯克变焦（滑动变焦）：镜头向后拉的同时焦距推近，主体大小保持不变而背景急剧变形压缩，营造眩晕与不安的心理冲击。【场景与情绪描述】。",
    tags: ["滑动变焦", "心理", "模板"], ratio: "16:9", duration: 5,
  },
];

/** 按分类与关键词(标题、提示词、标签)筛选 */
export function searchPrompts(query: string, category: PromptFilter = "all", templates = PROMPT_TEMPLATES) {
  const keyword = query.trim().toLowerCase();
  return templates.filter((template) => {
    if (category !== "all" && template.category !== category) return false;
    if (!keyword) return true;
    return [template.title, template.prompt, ...template.tags].some((text) => text.toLowerCase().includes(keyword));
  });
}

/** 推荐时长按模型上限就近取整(不超过上限) */
export function fitDuration(duration: number | undefined, maxDuration: number, presets: number[]) {
  if (!duration) return undefined;
  const allowed = presets.filter((value) => value <= maxDuration);
  if (!allowed.length) return undefined;
  return allowed.reduce((best, value) => (Math.abs(value - duration) < Math.abs(best - duration) ? value : best), allowed[0]);
}

/** 模板需要的最少参考图数量 */
export function requiredReferences(template: PromptTemplate) {
  if (template.referenceMode === "first_last") return 2;
  if (template.referenceMode === "first" || template.referenceMode === "references") return 1;
  return 0;
}

/** 自定义提示词的标签:逗号/顿号/空格分隔,去重,最多 6 个 */
export function parsePromptTags(text: string) {
  return [...new Set(text.split(/[,，、\s]+/).map((tag) => tag.trim().slice(0, 12)).filter(Boolean))].slice(0, 6);
}
